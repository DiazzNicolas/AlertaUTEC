// lambda/incidents/createIncident.js
import { v4 as uuidv4 } from 'uuid';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { putItem, getUserById } from '../utils/dynamodb.js';
import { requireAuth } from '../utils/auth.js';
import { created, badRequest, unauthorized, internalError } from '../utils/responses.js';
import { validateCreateIncident, sanitizeString } from '../utils/validators.js';
import { uploadMultipleImages } from '../utils/s3.js';

// Importamos las funciones de broadcast WebSocket
import { notifyNewIncident } from '../websocket/broadcast.js';

const sns = new SNSClient();
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;
const SNS_TOPIC_ARN = process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;

// ===== FUNCIÓN PARA PUBLICAR NOTIFICACIÓN EN SNS =====
async function publishIncidentNotification(incidentData) {
  try {
    const message = formatIncidentMessage(incidentData);
    
    const params = {
      TopicArn: SNS_TOPIC_ARN,
      Message: message,
      Subject: `🚨 Nuevo Incidente [${getPriorityLabel(incidentData.priority)}]: ${incidentData.title}`,
      MessageAttributes: {
        priority: {
          DataType: 'String',
          StringValue: incidentData.priority
        },
        category: {
          DataType: 'String',
          StringValue: incidentData.category
        },
        incidentId: {
          DataType: 'String',
          StringValue: incidentData.incidentId
        }
      }
    };

    const command = new PublishCommand(params);
    await sns.send(command);
    console.log('Mensaje publicado en SNS:', SNS_TOPIC_ARN);
  } catch (error) {
    console.error('Error publicando en SNS:', error);
    throw error;
  }
}

// ===== FORMATEAR MENSAJE PARA EMAIL =====
function formatIncidentMessage(incident) {
  const priorityLabel = getPriorityLabel(incident.priority);
  const priorityEmoji = getPriorityEmoji(incident.priority);
  
  return `
╔════════════════════════════════════════════════════════════════╗
║            ${priorityEmoji} NUEVO INCIDENTE REPORTADO ${priorityEmoji}            ║
╚════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INFORMACIÓN GENERAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🆔 ID del Incidente: ${incident.incidentId}

📝 Título: ${incident.title}

📋 Descripción:
${incident.description}

🏷️  Categoría: ${incident.category.toUpperCase()}

⚠️  Prioridad: ${priorityLabel}

📊 Estado: ${incident.status.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📍 UBICACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 Edificio: ${incident.location.building}
🔢 Piso: ${incident.location.floor}
🚪 Sala: ${incident.location.room}
${incident.location.specificLocation ? `📌 Ubicación específica: ${incident.location.specificLocation}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  👤 INFORMACIÓN DEL REPORTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reportado por: ${incident.reportedBy.name}
Email: ${incident.reportedBy.email}
ID de Usuario: ${incident.reportedBy.userId}

🕐 Fecha y Hora: ${formatDate(incident.createdAt)}

⚙️ AlertaUtec
📧 Este es un correo automático. Por favor no responder.

Si desea dejar de recibir estas notificaciones, use el enlace de 
"Unsubscribe" al final de este correo.
  `.trim();
}

// ===== FUNCIONES HELPER =====
function getPriorityLabel(priority) {
  const labels = {
    low: 'BAJA ⚪',
    medium: 'MEDIA 🟡',
    high: 'ALTA 🟠',
    critical: 'CRÍTICA 🔴'
  };
  return labels[priority] || priority.toUpperCase();
}

function getPriorityEmoji(priority) {
  const emojis = {
    low: '✅',
    medium: '⚠️',
    high: '🚨',
    critical: '🔥'
  };
  return emojis[priority] || '📢';
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Lima'
  });
}

// ===== HANDLER PRINCIPAL =====
export const handler = async (event) => {
  try {
    console.log('=== CREAR INCIDENTE ===');

    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
      console.log('Usuario autenticado:', user.userId, user.role);
    } catch (error) {
      return unauthorized(error.message);
    }

    // Parsear body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return badRequest('Formato JSON inválido');
    }

    // Validar datos
    const validation = validateCreateIncident(body);
    if (!validation.valid) {
      return badRequest('Datos del incidente inválidos', { errors: validation.errors });
    }

    const { title, description, category, priority, location, images } = body;

    // Generar ID único
    const incidentId = `inc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const currentTimestamp = Date.now();

    const incidentItem = {
      incidentId,
      title: sanitizeString(title),
      description: sanitizeString(description),
      category,
      priority,
      status: 'pending',
      location: {
        building: sanitizeString(location.building),
        floor: location.floor,
        room: sanitizeString(location.room),
        specificLocation: location.specificLocation
          ? sanitizeString(location.specificLocation)
          : null
      },
      images: [],
      reportedBy: user.userId,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
      comments: []
    };

    // Subir imágenes si existen
    if (images?.length > 0) {
      try {
        const uploadedImages = await uploadMultipleImages(images, incidentId);
        incidentItem.images = uploadedImages.map(img => img.s3Key);
      } catch (err) {
        console.error('Error subiendo imágenes:', err.message);
      }
    }

    // Guardar incidente en DynamoDB
    await putItem(INCIDENTS_TABLE, incidentItem);

    // Obtener datos del usuario que reporta
    const reporter = await getUserById(user.userId);
    const reporterInfo = {
      userId: user.userId,
      name: reporter?.name || 'Usuario',
      email: reporter?.email || ''
    };

    // ===== NOTIFICACIÓN WEBSOCKET A ADMINISTRADORES =====
    try {
      await notifyNewIncident({
        incidentId: incidentItem.incidentId,
        title: incidentItem.title,
        description: incidentItem.description,
        category: incidentItem.category,
        priority: incidentItem.priority,
        status: incidentItem.status,
        location: incidentItem.location,
        reportedBy: reporterInfo,
        createdAt: incidentItem.createdAt
      });
      console.log('✅ Notificación WebSocket enviada a administradores');
    } catch (err) {
      console.error('❌ Error notificando via WebSocket:', err.message);
      // No bloqueamos la creación del incidente por esto
    }

    // ===== NOTIFICACIÓN POR CORREO ELECTRÓNICO (ASÍNCRONA VIA SNS) =====
    try {
      await publishIncidentNotification({
        incidentId: incidentItem.incidentId,
        title: incidentItem.title,
        description: incidentItem.description,
        category: incidentItem.category,
        priority: incidentItem.priority,
        status: incidentItem.status,
        location: incidentItem.location,
        reportedBy: reporterInfo,
        createdAt: incidentItem.createdAt
      });
      console.log('✅ Notificación por correo publicada en SNS');
    } catch (err) {
      console.error('❌ Error publicando notificación por correo:', err.message);
      // No bloqueamos la creación del incidente por esto
    }

    // Respuesta al creador
    return created('Incidente creado exitosamente', {
      incidentId,
      title: incidentItem.title,
      description: incidentItem.description,
      category: incidentItem.category,
      priority: incidentItem.priority,
      status: incidentItem.status,
      location: incidentItem.location,
      reportedBy: reporterInfo,
      createdAt: currentTimestamp,
      imageUrls: incidentItem.images.map(img => `https://mi-bucket.s3.amazonaws.com/${img}`),
      assignedTo: null
    });

  } catch (error) {
    console.error('Error en createIncident:', error.message, error.stack);
    return internalError('Error al crear incidente');
  }
};
