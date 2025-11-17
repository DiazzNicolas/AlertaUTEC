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
    console.log('=== LISTAR INCIDENTES ===');
    
    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
      console.log('Usuario autenticado:', user.userId, user.role);
    } catch (error) {
      console.error('Error de autenticación:', error.message);
      return unauthorized(error.message);
    }

    // Obtener query parameters
    const params = event.queryStringParameters || {};
    console.log('Query params:', params);
    
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

    // Todos los usuarios pueden ver todos los incidentes con filtros
    let incidentsResult;
    
    console.log('Obteniendo todos los incidentes con filtros para usuario:', user.role);
    incidentsResult = await getFilteredIncidents(
      status,
      priority,
      category,
      assignedTo,
      building,
      limit,
      lastKey
    );

    console.log(`Incidentes encontrados: ${incidentsResult.items.length}`);

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

    console.log('=== LISTADO EXITOSO ===');
    return successResponse(
      `${enrichedIncidents.length} incidente(s) encontrado(s)`,
      responseData
    );

  } catch (error) {
    console.error('=== ERROR EN LIST INCIDENTS ===');
    console.error('Tipo:', error.name);
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    return internalError('Error al listar incidentes');
  }
};

/**
 * Obtiene incidentes reportados por un estudiante
 */
async function getStudentIncidents(studentId, status, limit, lastKey) {
  const options = {
    limit,
    lastEvaluatedKey: lastKey
  };

  // Construir filter expression
  if (status) {
    options.filterExpression = 'reportedBy = :studentId AND #status = :status';
    options.expressionValues = { 
      ':studentId': studentId,
      ':status': status 
    };
    options.expressionNames = { '#status': 'status' };
  } else {
    options.filterExpression = 'reportedBy = :studentId';
    options.expressionValues = { ':studentId': studentId };
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
  const expressionNames = { '#status': 'status' };

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
    expressionNames['#location'] = 'location';
    expressionNames['#building'] = 'building';
  }

  return scanItems(INCIDENTS_TABLE, {
    filterExpression,
    expressionValues,
    expressionNames,
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
  const expressionNames = {};

  if (category) {
    filterExpression = 'category = :category';
    expressionValues[':category'] = category;
  }
  if (building) {
    const buildingFilter = '#location.#building = :building';
    expressionValues[':building'] = building;
    expressionNames['#location'] = 'location';
    expressionNames['#building'] = 'building';
    filterExpression = filterExpression 
      ? `${filterExpression} AND ${buildingFilter}`
      : buildingFilter;
  }

  // Si no hay filtros, devolver todos los incidentes
  if (!filterExpression) {
    return scanItems(INCIDENTS_TABLE, {
      limit,
      lastEvaluatedKey: lastKey
    });
  }

  return scanItems(INCIDENTS_TABLE, {
    filterExpression,
    expressionValues,
    expressionNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
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
    try {
      const userItems = await batchGetItems(USERS_TABLE, keys);
      for (const user of userItems) {
        users[user.userId] = user;
      }
    } catch (error) {
      console.error('Error obteniendo usuarios:', error);
      // Continuar sin enriquecer si hay error
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
        studentCode: reporter.studentCode || null
      };
    } else if (reportedById) {
      // Si no se encontró el usuario, mantener solo el ID
      enrichedIncident.reportedBy = {
        userId: reportedById,
        name: 'Usuario desconocido',
        email: null
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
        specialty: worker.specialty || 'General',
        workloadPoints: worker.workloadPoints || 0
      };
    } else if (assignedToId) {
      enrichedIncident.assignedTo = {
        userId: assignedToId,
        name: 'Trabajador desconocido',
        email: null
      };
    } else {
      // Si no hay assignedTo, asegurarse de que sea null en la respuesta
      enrichedIncident.assignedTo = null;
    }

    enriched.push(enrichedIncident);
  }

  return enriched;
}