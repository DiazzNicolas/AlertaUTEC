/**
 * Lambda function: Listar incidentes con filtros
 * Endpoint: GET /incidents
 * Requiere: Autenticación
 */
import { queryItems, scanItems, batchGetItems } from '../utils/dynamodb.js';
import { requireAuth, isStudent, isWorker } from '../utils/auth.js';
import { successResponse, unauthorized, internalError } from '../utils/responses.js';

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

/**
 * Lista incidentes con filtros avanzados
 * 
 * Query Parameters:
 * - status: pending, assigned, in_progress, resolved, closed
 * - priority: low, medium, high, urgent
 * - category: electricidad, plomeria, etc.
 * - assignedTo: userId del trabajador
 * - building: nombre del edificio
 * - limit: número de resultados (default: 50, max: 100)
 * - lastKey: para paginación
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

    // Obtener query parameters
    const params = event.queryStringParameters || {};
    
    const status = params.status;
    const priority = params.priority;
    const category = params.category;
    let assignedTo = params.assignedTo;
    const building = params.building;
    let limit = parseInt(params.limit || '50');
    const lastKeyStr = params.lastKey;

    // Validar límite
    if (limit > 100) {
      limit = 100;
    }

    // Parsear lastKey si existe
    let lastKey = null;
    if (lastKeyStr) {
      try {
        lastKey = JSON.parse(lastKeyStr);
      } catch (error) {
        console.error('Error parsing lastKey:', error);
      }
    }

    // Determinar qué incidentes puede ver el usuario
    let incidentsResult;

    // Si es estudiante, solo ve sus propios incidentes
    if (isStudent(user)) {
      incidentsResult = await getStudentIncidents(
        user.userId,
        status,
        limit,
        lastKey
      );
    }
    // Si es trabajador, ve incidentes asignados a él + pendientes
    else if (isWorker(user)) {
      if (assignedTo && assignedTo !== user.userId) {
        // Workers no pueden ver incidentes de otros workers
        assignedTo = user.userId;
      }

      incidentsResult = await getWorkerIncidents(
        user.userId,
        status,
        priority,
        category,
        building,
        limit,
        lastKey
      );
    }
    // Si es admin, ve todos los incidentes con filtros
    else {
      incidentsResult = await getFilteredIncidents(
        status,
        priority,
        category,
        assignedTo,
        building,
        limit,
        lastKey
      );
    }

    // Obtener información de usuarios (reportedBy, assignedTo)
    const incidents = incidentsResult.items;
    const enrichedIncidents = await enrichIncidentsWithUsers(incidents);

    // Preparar respuesta
    const responseData = {
      incidents: enrichedIncidents,
      count: enrichedIncidents.length,
      limit
    };

    if (incidentsResult.lastEvaluatedKey) {
      responseData.lastEvaluatedKey = JSON.stringify(
        incidentsResult.lastEvaluatedKey
      );
    }

    return successResponse(
      `${enrichedIncidents.length} incidente(s) encontrado(s)`,
      responseData
    );

  } catch (error) {
    console.error('Error en list incidents:', error);
    return internalError('Error al listar incidentes');
  }
};

/**
 * Obtiene incidentes reportados por un estudiante
 */
async function getStudentIncidents(studentId, status, limit, lastKey) {
  const options = {
    filterExpression: 'reportedBy = :studentId',
    expressionValues: { ':studentId': studentId },
    limit,
    lastEvaluatedKey: lastKey
  };

  if (status) {
    options.filterExpression += ' AND #status = :status';
    options.expressionValues[':status'] = status;
    options.expressionNames = { '#status': 'status' };
  }

  return scanItems(INCIDENTS_TABLE, options);
}

/**
 * Obtiene incidentes para un trabajador (asignados + pendientes)
 */
async function getWorkerIncidents(
  workerId,
  status,
  priority,
  category,
  building,
  limit,
  lastKey
) {
  let filterExpression = '';
  const expressionValues = {};

  // Si hay filtro de status específico
  if (status) {
    if (status === 'pending') {
      filterExpression = '#status = :status';
      expressionValues[':status'] = 'pending';
    } else {
      filterExpression = 'assignedTo = :workerId AND #status = :status';
      expressionValues[':workerId'] = workerId;
      expressionValues[':status'] = status;
    }
  } else {
    // Mostrar incidentes asignados a él O pendientes
    // En DynamoDB esto requiere un scan con filter
    filterExpression = '(assignedTo = :workerId) OR (#status = :pending)';
    expressionValues[':workerId'] = workerId;
    expressionValues[':pending'] = 'pending';
  }

  // Agregar filtros adicionales
  if (priority) {
    filterExpression += ' AND priority = :priority';
    expressionValues[':priority'] = priority;
  }
  if (category) {
    filterExpression += ' AND category = :category';
    expressionValues[':category'] = category;
  }
  if (building) {
    filterExpression += ' AND #location.#building = :building';
    expressionValues[':building'] = building;
  }

  return scanItems(INCIDENTS_TABLE, {
    filterExpression,
    expressionValues,
    expressionNames: { 
      '#status': 'status',
      ...(building && { '#location': 'location', '#building': 'building' })
    },
    limit,
    lastEvaluatedKey: lastKey
  });
}

/**
 * Obtiene incidentes con filtros (admin)
 */
async function getFilteredIncidents(
  status,
  priority,
  category,
  assignedTo,
  building,
  limit,
  lastKey
) {
  // Si hay status, usar el índice StatusCreatedAtIndex
  if (status) {
    const result = await queryItems(
      INCIDENTS_TABLE,
      '#status = :status',
      { ':status': status },
      {
        indexName: 'StatusCreatedAtIndex',
        limit,
        scanForward: false,
        lastEvaluatedKey: lastKey,
        expressionNames: { '#status': 'status' }
      }
    );

    // Aplicar filtros adicionales en memoria
    let items = result.items;
    if (priority) {
      items = items.filter(i => i.priority === priority);
    }
    if (category) {
      items = items.filter(i => i.category === category);
    }
    if (assignedTo) {
      items = items.filter(i => i.assignedTo === assignedTo);
    }
    if (building) {
      items = items.filter(i => i.location?.building === building);
    }

    return { ...result, items };
  }

  // Si hay assignedTo, usar el índice AssignedToIndex
  if (assignedTo) {
    const result = await queryItems(
      INCIDENTS_TABLE,
      'assignedTo = :assignedTo',
      { ':assignedTo': assignedTo },
      {
        indexName: 'AssignedToIndex',
        limit,
        scanForward: false,
        lastEvaluatedKey: lastKey
      }
    );

    // Aplicar filtros adicionales
    let items = result.items;
    if (priority) {
      items = items.filter(i => i.priority === priority);
    }
    if (category) {
      items = items.filter(i => i.category === category);
    }
    if (building) {
      items = items.filter(i => i.location?.building === building);
    }

    return { ...result, items };
  }

  // Si hay priority, usar el índice PriorityIndex
  if (priority) {
    const result = await queryItems(
      INCIDENTS_TABLE,
      'priority = :priority',
      { ':priority': priority },
      {
        indexName: 'PriorityIndex',
        limit,
        scanForward: false,
        lastEvaluatedKey: lastKey
      }
    );

    // Aplicar filtros adicionales
    let items = result.items;
    if (category) {
      items = items.filter(i => i.category === category);
    }
    if (building) {
      items = items.filter(i => i.location?.building === building);
    }

    return { ...result, items };
  }

  // Si solo hay filtros simples, hacer scan
  let filterExpression = null;
  const expressionValues = {};

  if (category) {
    filterExpression = 'category = :category';
    expressionValues[':category'] = category;
  }
  if (building) {
    const buildingFilter = '#location.#building = :building';
    expressionValues[':building'] = building;
    filterExpression = filterExpression 
      ? `${filterExpression} AND ${buildingFilter}`
      : buildingFilter;
  }

  return scanItems(INCIDENTS_TABLE, {
    filterExpression,
    expressionValues,
    expressionNames: building ? { '#location': 'location', '#building': 'building' } : undefined,
    limit,
    lastEvaluatedKey: lastKey
  });
}

/**
 * Agrega información de usuarios (reportedBy, assignedTo) a los incidentes
 */
async function enrichIncidentsWithUsers(incidents) {
  if (!incidents || incidents.length === 0) {
    return [];
  }

  // Recolectar todos los user IDs únicos
  const userIds = new Set();
  for (const incident of incidents) {
    if (incident.reportedBy) {
      userIds.add(incident.reportedBy);
    }
    if (incident.assignedTo) {
      userIds.add(incident.assignedTo);
    }
  }

  // Obtener usuarios en batch
  const users = {};
  if (userIds.size > 0) {
    const keys = Array.from(userIds).map(uid => ({ userId: uid }));
    const userItems = await batchGetItems(USERS_TABLE, keys);
    for (const user of userItems) {
      users[user.userId] = user;
    }
  }

  // Enriquecer incidentes
  const enriched = [];
  for (const incident of incidents) {
    const enrichedIncident = { ...incident };

    // Agregar info del reportador
    const reportedById = incident.reportedBy;
    if (reportedById && users[reportedById]) {
      const reporter = users[reportedById];
      enrichedIncident.reportedBy = {
        userId: reporter.userId,
        name: reporter.name,
        email: reporter.email,
        studentCode: reporter.studentCode
      };
    }

    // Agregar info del trabajador asignado
    const assignedToId = incident.assignedTo;
    if (assignedToId && users[assignedToId]) {
      const worker = users[assignedToId];
      enrichedIncident.assignedTo = {
        userId: worker.userId,
        name: worker.name,
        email: worker.email,
        specialty: worker.specialty,
        workloadPoints: worker.workloadPoints || 0
      };
    }

    enriched.push(enrichedIncident);
  }

  return enriched;
}