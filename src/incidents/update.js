/**
 * Lambda function: Actualizar incidente
 * Endpoint: PUT /incidents/{id}
 * Requiere: Autenticación
 * 
 * Permisos:
 * - Alumno: solo puede comentar en sus propios incidentes
 * - Worker: puede actualizar estado y comentar en incidentes asignados
 * - Admin: puede actualizar cualquier incidente
 */
import { getIncidentById, updateItem } from '../utils/dynamodb.js';
import { requireAuth, canUpdateIncident, isAdmin, isStudent } from '../utils/auth.js';
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
 *   "status": "in_progress",         // Opcional
 *   "comment": "Iniciando reparación", // Opcional
 *   "priority": "high"                // Opcional (solo admin)
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

    // Obtener incidentId del path
    const incidentId = event.pathParameters?.id;

    if (!incidentId) {
      return badRequest('ID de incidente no proporcionado');
    }

    // Obtener incidente actual
    const incident = await getIncidentById(incidentId);

    if (!incident) {
      return notFound(`Incidente ${incidentId} no encontrado`);
    }

    // Verificar permisos
    if (!canUpdateIncident(user, incident)) {
      return forbidden('No tienes permiso para actualizar este incidente');
    }

    // Parsear body
    const body = JSON.parse(event.body || '{}');

    // Validar datos
    const validation = validateUpdateIncident(body);
    if (!validation.valid) {
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

    // Actualizar estado (solo workers y admins)
    if (status) {
      if (isStudent(user)) {
        return forbidden('Los estudiantes no pueden cambiar el estado');
      }

      // Validar transición de estado
      if (!validateIncidentStatusTransition(incident.status, status)) {
        return badRequest(
          `Transición de estado inválida: ${incident.status} -> ${status}`,
          {
            currentStatus: incident.status,
            requestedStatus: status,
            allowedTransitions: getAllowedTransitions(incident.status)
          }
        );
      }

      updateParts.push('#status = :status');
      expressionValues[':status'] = status;
      expressionNames['#status'] = 'status';

      // Si se marca como resuelto, guardar timestamp
      if (status === 'resolved' && !incident.resolvedAt) {
        updateParts.push('resolvedAt = :resolvedAt');
        expressionValues[':resolvedAt'] = currentTimestamp;
      }
    }

    // Actualizar prioridad (solo admins)
    if (priority) {
      if (!isAdmin(user)) {
        return forbidden('Solo los administradores pueden cambiar la prioridad');
      }

      updateParts.push('priority = :priority');
      expressionValues[':priority'] = priority;
    }

    // Agregar comentario
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

      updateParts.push('comments = :comments');
      expressionValues[':comments'] = updatedComments;
    }

    // Siempre actualizar updatedAt
    updateParts.push('updatedAt = :updatedAt');

    // Ejecutar actualización
    if (updateParts.length > 1) { // Más que solo updatedAt
      const updateExpression = 'SET ' + updateParts.join(', ');

      const updatedIncident = await updateItem(
        INCIDENTS_TABLE,
        { incidentId },
        updateExpression,
        expressionValues,
        Object.keys(expressionNames).length > 0 ? expressionNames : null
      );

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

      return successResponse(
        'Incidente actualizado exitosamente',
        responseData
      );
    } else {
      return badRequest('No hay datos para actualizar');
    }

  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    console.error('Error en update incident:', error);
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