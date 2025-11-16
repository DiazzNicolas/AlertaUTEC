/**
 * Lambda function: Crear nuevo incidente
 * Endpoint: POST /incidents
 * Requiere: Autenticación (todos los roles pueden crear incidentes)
 */
import { v4 as uuidv4 } from 'uuid';
import { putItem, getUserById } from '../utils/dynamodb.js';
import { requireAuth } from '../utils/auth.js';
import { created, badRequest, unauthorized, internalError } from '../utils/responses.js';
import { validateCreateIncident, sanitizeString } from '../utils/validators.js';
import { uploadMultipleImages } from '../utils/s3.js';

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;

/**
 * Crea un nuevo incidente en el sistema
 * 
 * Request Body:
 * {
 *   "title": "Luz fundida en Aula 302",
 *   "description": "La luz fluorescente está fundida...",
 *   "category": "electricidad",
 *   "priority": "medium",
 *   "location": {
 *     "building": "Pabellón A",
 *     "floor": 3,
 *     "room": "302",
 *     "specificLocation": "Aula de clases"
 *   },
 *   "images": ["data:image/jpeg;base64,...", ...]
 * }
 */
export const handler = async (event) => {
  try {
    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
    } catch (error) {
      return unauthorized(error.message);
    }

    // Parsear body
    const body = JSON.parse(event.body || '{}');

    // Validar datos
    const validation = validateCreateIncident(body);
    if (!validation.valid) {
      return badRequest('Datos del incidente inválidos', {
        errors: validation.errors
      });
    }

    const { title, description, category, priority, location, images } = body;

    // Generar ID único
    const incidentId = `inc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const currentTimestamp = Date.now();

    // Construir objeto de incidente
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
      assignedTo: null,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
      resolvedAt: null,
      comments: []
    };

    // Subir imágenes a S3 si existen
    let imageUrls = [];
    if (images && images.length > 0) {
      try {
        const uploadedImages = await uploadMultipleImages(images, incidentId);
        
        // Guardar las keys de S3 en el incidente
        incidentItem.images = uploadedImages.map(img => img.s3Key);
        
        // Guardar las URLs públicas para la respuesta
        imageUrls = uploadedImages.map(img => img.publicUrl);
        
      } catch (error) {
        console.error('Error subiendo imágenes:', error.message);
        // Continuar sin imágenes en caso de error
        incidentItem.images = [];
      }
    }

    // Guardar incidente en DynamoDB
    await putItem(INCIDENTS_TABLE, incidentItem);

    // Obtener datos del usuario que reporta
    const reporter = await getUserById(user.userId);
    const reporterInfo = {
      userId: user.userId,
      name: reporter ? reporter.name : 'Usuario',
      email: reporter ? reporter.email : ''
    };

    // TODO: Enviar notificación WebSocket a administradores
    // await broadcastNewIncident(incidentItem, reporterInfo);

    // TODO: Enviar notificación SNS
    // await sendSNSNotification(incidentItem);

    // Preparar respuesta
    const responseData = {
      incidentId,
      title: incidentItem.title,
      description: incidentItem.description,
      category: incidentItem.category,
      priority: incidentItem.priority,
      status: incidentItem.status,
      location: incidentItem.location,
      reportedBy: reporterInfo,
      createdAt: currentTimestamp,
      imageUrls
    };

    return created('Incidente creado exitosamente', responseData);

  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    console.error('Error en create incident:', error);
    return internalError('Error al crear incidente');
  }
};