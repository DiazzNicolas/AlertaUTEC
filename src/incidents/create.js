import { v4 as uuidv4 } from 'uuid';
import { putItem, getUserById } from '../utils/dynamodb.js';
import { requireAuth } from '../utils/auth.js';
import { created, badRequest, unauthorized, internalError } from '../utils/responses.js';
import { validateCreateIncident, sanitizeString } from '../utils/validators.js';
import { uploadMultipleImages } from '../utils/s3.js';

// Importamos las funciones de broadcast
import { notifyNewIncident } from '../websocket/broadcast.js';

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;

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

    // ===== ENVÍO DE NOTIFICACIÓN A ADMINISTRADORES =====
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
      console.log('Notificación enviada a administradores');
    } catch (err) {
      console.error('Error notificando a admins:', err.message);
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
