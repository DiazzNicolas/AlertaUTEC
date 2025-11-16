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
    console.log('=== CREAR INCIDENTE ===');
    
    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
      console.log('Usuario autenticado:', user.userId, user.role);
    } catch (error) {
      console.error('Error de autenticación:', error.message);
      return unauthorized(error.message);
    }

    // Parsear body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
      console.log('Body parseado:', JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error('Error parseando JSON:', parseError);
      return badRequest('Formato JSON inválido');
    }

    // Validar datos
    console.log('Validando datos del incidente...');
    const validation = validateCreateIncident(body);
    console.log('Resultado validación:', validation);
    
    if (!validation.valid) {
      console.log('Validación falló:', validation.errors);
      return badRequest('Datos del incidente inválidos', {
        errors: validation.errors
      });
    }

    const { title, description, category, priority, location, images } = body;

    // Generar ID único
    const incidentId = `inc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const currentTimestamp = Date.now();

    console.log('Generando incidente con ID:', incidentId);

    // Construir objeto de incidente
    // IMPORTANTE: No incluir campos con null si están en GSI
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
      // NO incluir assignedTo si es null (está en GSI)
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
      // NO incluir resolvedAt si es null
      comments: []
    };

    // Subir imágenes a S3 si existen
    let imageUrls = [];
    if (images && images.length > 0) {
      console.log(`Subiendo ${images.length} imágenes a S3...`);
      try {
        const uploadedImages = await uploadMultipleImages(images, incidentId);
        
        // Guardar las keys de S3 en el incidente
        incidentItem.images = uploadedImages.map(img => img.s3Key);
        
        // Guardar las URLs públicas para la respuesta
        imageUrls = uploadedImages.map(img => img.publicUrl);
        
        console.log(`${uploadedImages.length} imágenes subidas exitosamente`);
      } catch (error) {
        console.error('Error subiendo imágenes:', error.message);
        // Continuar sin imágenes en caso de error
        incidentItem.images = [];
      }
    }

    // Guardar incidente en DynamoDB
    console.log('Guardando incidente en DynamoDB...');
    await putItem(INCIDENTS_TABLE, incidentItem);
    console.log('Incidente guardado exitosamente');

    // Obtener datos del usuario que reporta
    console.log('Obteniendo datos del reporter...');
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
      imageUrls,
      assignedTo: null // Puede ir null en la respuesta, solo no en DynamoDB
    };

    console.log('=== INCIDENTE CREADO EXITOSAMENTE ===');
    return created('Incidente creado exitosamente', responseData);

  } catch (error) {
    console.error('=== ERROR EN CREATE INCIDENT ===');
    console.error('Tipo de error:', error.name);
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    return internalError('Error al crear incidente');
  }
};