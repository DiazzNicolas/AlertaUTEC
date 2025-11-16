/**
 * Lambda function: Asignar trabajador a incidente
 * Endpoint: POST /incidents/{id}/assign
 * Requiere: Autenticación (solo admin)
 */
import { getIncidentById, getUserById, updateItem } from '../utils/dynamodb.js';
import { requireAuth, canAssignIncident } from '../utils/auth.js';
import { successResponse, badRequest, unauthorized, notFound, forbidden, internalError } from '../utils/responses.js';
import { 
  validateAssignIncident, 
  validateWorkerCapacity, 
  validatePriorityPoints, 
  getWorkerStatus 
} from '../utils/validators.js';

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

/**
 * Asigna un trabajador a un incidente (asignación manual por admin)
 * 
 * Request Body:
 * {
 *   "workerId": "usr_worker123"
 * }
 * 
 * Validaciones:
 * - Solo administradores pueden asignar
 * - El trabajador debe existir y estar activo
 * - El trabajador no debe exceder su capacidad máxima (20 puntos)
 * - El incidente debe estar en estado 'pending' o 'assigned'
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

    // Verificar permisos (solo admin puede asignar)
    if (!canAssignIncident(user)) {
      return forbidden('Solo los administradores pueden asignar incidentes');
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

    // Validar que el incidente pueda ser asignado
    if (!['pending', 'assigned'].includes(incident.status)) {
      return badRequest(
        `No se puede asignar un incidente en estado '${incident.status}'`,
        { currentStatus: incident.status }
      );
    }

    // Parsear body
    const body = JSON.parse(event.body || '{}');

    // Validar datos
    const validation = validateAssignIncident(body);
    if (!validation.valid) {
      return badRequest('Datos de asignación inválidos', {
        errors: validation.errors
      });
    }

    const { workerId } = body;

    // Obtener trabajador
    const worker = await getUserById(workerId);

    if (!worker) {
      return notFound(`Trabajador ${workerId} no encontrado`);
    }

    // Validar que sea un trabajador
    if (worker.role !== 'worker') {
      return badRequest(
        `El usuario ${workerId} no es un trabajador`,
        { role: worker.role }
      );
    }

    // Validar que el trabajador esté activo
    if (worker.status === 'inactive') {
      return badRequest(
        'El trabajador está inactivo',
        { workerStatus: worker.status }
      );
    }

    // Validar capacidad del trabajador
    const currentWorkload = worker.workloadPoints || 0;
    const incidentPriority = incident.priority;

    if (!validateWorkerCapacity(currentWorkload, incidentPriority)) {
      const priorityPoints = validatePriorityPoints(incidentPriority);
      return badRequest(
        'El trabajador ha excedido su capacidad máxima',
        {
          currentWorkload,
          incidentPoints: priorityPoints,
          maxWorkload: 20,
          wouldBe: currentWorkload + priorityPoints
        }
      );
    }

    const currentTimestamp = Date.now();

    // Si ya estaba asignado a otro trabajador, liberar su carga
    const oldWorkerId = incident.assignedTo;
    if (oldWorkerId && oldWorkerId !== workerId) {
      const oldWorker = await getUserById(oldWorkerId);
      if (oldWorker) {
        const oldPoints = validatePriorityPoints(incidentPriority);
        await updateWorkerWorkload(
          oldWorkerId,
          (oldWorker.workloadPoints || 0) - oldPoints,
          (oldWorker.activeIncidents || 0) - 1
        );
      }
    }

    // Actualizar incidente
    await updateItem(
      INCIDENTS_TABLE,
      { incidentId },
      'SET assignedTo = :workerId, #status = :status, updatedAt = :updatedAt',
      {
        ':workerId': workerId,
        ':status': 'assigned',
        ':updatedAt': currentTimestamp
      },
      { '#status': 'status' }
    );

    // Actualizar carga del trabajador
    const priorityPoints = validatePriorityPoints(incidentPriority);
    const newWorkload = currentWorkload + priorityPoints;
    const newActiveIncidents = (worker.activeIncidents || 0) + 1;

    await updateWorkerWorkload(workerId, newWorkload, newActiveIncidents);

    // TODO: Enviar notificación WebSocket al trabajador
    // await notifyWorkerAssignment(workerId, incident);

    // TODO: Enviar notificación al estudiante que reportó
    // await notifyStudentAssignment(incident.reportedBy, worker, incident);

    // Preparar respuesta
    const responseData = {
      incidentId,
      assignedTo: workerId,
      workerName: worker.name,
      workerSpecialty: worker.specialty,
      workerDepartment: worker.department,
      status: 'assigned',
      updatedAt: currentTimestamp,
      workerNewWorkload: newWorkload,
      workerStatus: getWorkerStatus(newWorkload)
    };

    return successResponse(
      'Trabajador asignado exitosamente',
      responseData
    );

  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    console.error('Error en assign incident:', error);
    return internalError('Error al asignar trabajador');
  }
};

/**
 * Actualiza la carga de trabajo de un trabajador
 */
async function updateWorkerWorkload(workerId, newWorkload, newActiveIncidents) {
  try {
    await updateItem(
      USERS_TABLE,
      { userId: workerId },
      'SET workloadPoints = :workload, activeIncidents = :active, #status = :status, updatedAt = :updatedAt',
      {
        ':workload': newWorkload,
        ':active': newActiveIncidents,
        ':status': getWorkerStatus(newWorkload),
        ':updatedAt': Date.now()
      },
      { '#status': 'status' }
    );
  } catch (error) {
    console.error(`Error actualizando carga del trabajador ${workerId}:`, error);
  }
}