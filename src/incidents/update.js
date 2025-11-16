/**
 * Lambda function: Actualizar incidente
 * Endpoint: PUT /incidents/{id}
 * Requiere: Autenticación
 * 
 * Permisos:
 * - Alumno: NO puede actualizar nada (solo reporta incidentes)
 * - Worker: puede cambiar status y agregar comentarios en incidentes asignados (NO puede cambiar priority)
 * - Admin: puede hacer todo (status, comment, priority) en cualquier incidente
 */
import { getIncidentById, updateItem } from '../utils/dynamodb.js';
import { requireAuth, isAdmin, isStudent, isWorker } from '../utils/auth.js';
import { successResponse, badRequest, unauthorized, notFound, forbidden, internalError } from '../utils/responses.js';
import { 
  validateUpdateIncident, 
  validateIncidentStatusTransition, 
  sanitizeString 
} from '../utils/validators.js';

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;

/**
 * Actualiza un incidente (estado, comentarios, prioridad)
 * 
 * Request Body:
 * {
 *   "status": "in_progress",         // Worker (en sus incidentes) y Admin
 *   "comment": "Iniciando reparación", // Worker (en sus incidentes) y Admin
 *   "priority": "high"                // Solo Admin
 * }
 */
export const handler = async (event) => {
  try {
    console.log('=== ACTUALIZAR INCIDENTE ===');
    
    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
      console.log('Usuario autenticado:', user.userId, user.role);
    } catch (error) {
      console.error('Error de autenticación:', error.message);
      return unauthorized(error.message);
    }

    // Los alumnos NO pueden actualizar incidentes
    if (isStudent(user)) {
      console.log('Alumno intentó actualizar incidente - DENEGADO');
      return forbidden('Los alumnos no pueden actualizar incidentes. Solo pueden reportarlos.');
    }

    // Obtener incidentId del path
    const incidentId = event.pathParameters?.id;
    console.log('Incident ID:', incidentId);

    if (!incidentId) {
      return badRequest('ID de incidente no proporcionado');
    }

    // Obtener incidente actual
    console.log('Obteniendo incidente...');
    const incident = await getIncidentById(incidentId);

    if (!incident) {
      console.log('Incidente no encontrado');
      return notFound(`Incidente ${incidentId} no encontrado`);
    }

    console.log('Incidente encontrado:', {
      status: incident.status,
      reportedBy: incident.reportedBy,
      assignedTo: incident.assignedTo
    });

    // Verificar permisos específicos para Workers
    if (isWorker(user)) {
      // Worker solo puede actualizar incidentes asignados a él
      if (incident.assignedTo !== user.userId) {
        console.log('Worker intentó actualizar incidente no asignado - DENEGADO');
        return forbidden('Solo puedes actualizar incidentes asignados a ti');
      }
    }

    // Admin puede actualizar cualquier incidente (no requiere verificación adicional)

    // Parsear body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
      console.log('Body parseado:', body);
    } catch (parseError) {
      console.error('Error parseando JSON:', parseError);
      return badRequest('Formato JSON inválido');
    }

    // Validar datos
    const validation = validateUpdateIncident(body);
    if (!validation.valid) {
      console.log('Validación falló:', validation.errors);
      return badRequest('Datos de actualización inválidos', {
        errors: validation.errors
      });
    }

    const { status, comment, priority } = body;
    const currentTimestamp = Date.now();

    // Construir expression de actualización
    const updateParts = [];
    const expressionValues = { ':updatedAt': currentTimestamp };
    const expressionNames = {};

    // ==========================================
    // ACTUALIZAR ESTADO (Worker y Admin)
    // ==========================================
    if (status) {
      // Validar transición de estado
      if (!validateIncidentStatusTransition(incident.status, status)) {
        console.log(`Transición de estado inválida: ${incident.status} -> ${status}`);
        return badRequest(
          `Transición de estado inválida: ${incident.status} → ${status}`,
          {
            currentStatus: incident.status,
            requestedStatus: status,
            allowedTransitions: getAllowedTransitions(incident.status),
            message: `Desde "${incident.status}" solo puedes cambiar a: ${getAllowedTransitions(incident.status).join(', ')}`
          }
        );
      }

      console.log(`Actualizando estado: ${incident.status} -> ${status}`);
      updateParts.push('#status = :status');
      expressionValues[':status'] = status;
      expressionNames['#status'] = 'status';

      // Si se marca como resuelto, guardar timestamp
      if (status === 'resolved' && !incident.resolvedAt) {
        updateParts.push('resolvedAt = :resolvedAt');
        expressionValues[':resolvedAt'] = currentTimestamp;
      }
    }

    // ==========================================
    // ACTUALIZAR PRIORIDAD (Solo Admin)
    // ==========================================
    if (priority) {
      if (!isAdmin(user)) {
        console.log('Worker intentó cambiar prioridad - DENEGADO');
        return forbidden('Solo los administradores pueden cambiar la prioridad');
      }

      console.log(`Actualizando prioridad: ${incident.priority} -> ${priority}`);
      updateParts.push('priority = :priority');
      expressionValues[':priority'] = priority;
    }

    // ==========================================
    // AGREGAR COMENTARIO (Worker y Admin)
    // ==========================================
    let newComment = null;
    if (comment) {
      const commentText = sanitizeString(comment);

      newComment = {
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        comment: commentText,
        timestamp: currentTimestamp
      };

      // Obtener comentarios actuales y agregar el nuevo
      const currentComments = incident.comments || [];
      const updatedComments = [...currentComments, newComment];

      console.log(`Agregando comentario de ${user.name} (${user.role})`);
      updateParts.push('comments = :comments');
      expressionValues[':comments'] = updatedComments;
    }

    // Siempre actualizar updatedAt
    updateParts.push('updatedAt = :updatedAt');

    // Ejecutar actualización
    if (updateParts.length > 1) { // Más que solo updatedAt
      const updateExpression = 'SET ' + updateParts.join(', ');

      console.log('Ejecutando actualización en DynamoDB...');
      const updatedIncident = await updateItem(
        INCIDENTS_TABLE,
        { incidentId },
        updateExpression,
        expressionValues,
        Object.keys(expressionNames).length > 0 ? expressionNames : null
      );

      console.log('Incidente actualizado exitosamente');

      // TODO: Enviar notificación WebSocket
      // await broadcastIncidentUpdate(updatedIncident);

      // Preparar respuesta
      const responseData = {
        incidentId,
        status: updatedIncident.status,
        priority: updatedIncident.priority,
        updatedAt: updatedIncident.updatedAt
      };

      if (newComment) {
        responseData.newComment = newComment;
      }

      if (updatedIncident.resolvedAt) {
        responseData.resolvedAt = updatedIncident.resolvedAt;
      }

      console.log('=== ACTUALIZACIÓN EXITOSA ===');
      return successResponse(
        'Incidente actualizado exitosamente',
        responseData
      );
    } else {
      console.log('No hay datos para actualizar');
      return badRequest('No hay datos para actualizar. Proporciona status, comment o priority.');
    }

  } catch (error) {
    console.error('=== ERROR EN UPDATE INCIDENT ===');
    console.error('Tipo:', error.name);
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    return internalError('Error al actualizar incidente');
  }
};

/**
 * Retorna las transiciones de estado permitidas
 */
function getAllowedTransitions(currentStatus) {
  const transitions = {
    pending: ['assigned'],
    assigned: ['in_progress', 'pending'],
    in_progress: ['resolved', 'assigned'],
    resolved: ['closed', 'in_progress'],
    closed: []
  };
  return transitions[currentStatus] || [];
}