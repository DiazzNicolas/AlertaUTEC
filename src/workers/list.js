import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";

import { successResponse, badRequest, unauthorized, forbidden, internalError } from "../utils/responses.js";
import { requireAuth, isAdmin } from "../utils/auth.js";
import { getWorkerStatus } from "../utils/validators.js";

/* ============================================================
   CONVERTIR DECIMALS A FLOAT (DynamoDB devuelve Decimals)
   ============================================================*/
function decimalToFloat(obj) {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'number') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => decimalToFloat(item));
  }
  
  if (typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = decimalToFloat(obj[key]);
    }
    return newObj;
  }
  
  return obj;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USERS_TABLE = process.env.USERS_TABLE;
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;

/* ============================================================
   OBTENER LISTA DE WORKERS
   ============================================================*/
async function getWorkers() {
  const result = await ddb.send(
    new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: "#role = :w",
      ExpressionAttributeNames: { "#role": "role" },
      ExpressionAttributeValues: { ":w": "worker" }
    })
  );
  return result.Items || [];
}

/* ============================================================
   OBTENER INCIDENTES POR WORKER
   ============================================================*/
async function getIncidentsByWorker(userId, limit = 20) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: INCIDENTS_TABLE,
      IndexName: "AssignedToIndex",
      KeyConditionExpression: "assignedTo = :u",
      ExpressionAttributeValues: { ":u": userId },
      Limit: limit
    })
  );
  return result.Items || [];
}

/* ============================================================
   ORDENADOR DE WORKERS
   ============================================================*/
function sortWorkers(workers, sortBy, order) {
  const reverse = order === "desc";

  if (sortBy === "workload") {
    return workers.sort((a, b) =>
      reverse
        ? b.workloadPoints - a.workloadPoints
        : a.workloadPoints - b.workloadPoints
    );
  }

  if (sortBy === "name") {
    return workers.sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return reverse
        ? nameB.localeCompare(nameA)
        : nameA.localeCompare(nameB);
    });
  }

  if (sortBy === "activeIncidents") {
    return workers.sort((a, b) =>
      reverse
        ? b.activeIncidents - a.activeIncidents
        : a.activeIncidents - b.activeIncidents
    );
  }

  return workers;
}

/* ============================================================
   HANDLER PRINCIPAL
   ============================================================*/
export const handler = async (event) => {
  try {
    // 1. Autenticación
    let user;
    try {
      user = requireAuth(event);
    } catch (err) {
      return unauthorized(err.message);
    }

    // 2. Validar admin
    if (!isAdmin(user)) {
      return forbidden("Solo los administradores pueden ver la lista de trabajadores");
    }

    // 3. Leer query parameters
    const params = event.queryStringParameters || {};

    const statusFilter = params.status;
    const specialtyFilter = params.specialty;

    const sortBy = params.sortBy || "workload";
    const order = params.order || "asc";

    let limit = parseInt(params.limit || "50", 10);
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100;

    if (!["workload", "name", "activeIncidents"].includes(sortBy)) {
      return badRequest("sortBy inválido. Use: workload, name, activeIncidents");
    }

    if (!["asc", "desc"].includes(order)) {
      return badRequest("order inválido. Use: asc, desc");
    }

    if (statusFilter && !["available", "moderate", "busy"].includes(statusFilter)) {
      return badRequest("status inválido. Use: available, moderate, busy");
    }

    // 4. Obtener workers
    const workers = await getWorkers();

    if (!workers.length) {
      return successResponse({
        message: "No hay trabajadores registrados",
        data: {
          workers: [],
          count: 0,
          sortedBy: sortBy,
          order
        }
      });
    }

    // 5. Enriquecer workers
    const enrichedWorkers = [];

    for (const worker of workers) {
      const workload = worker.workloadPoints || 0;
      const workerStatus = getWorkerStatus(workload);

      if (statusFilter && workerStatus !== statusFilter) continue;
      if (specialtyFilter && worker.specialty !== specialtyFilter) continue;

      // Incidentes del worker
      let incidents = [];
      try {
        incidents = await getIncidentsByWorker(worker.userId, 20);
      } catch (err) {
        console.log("Error obteniendo incidentes:", err);
      }

      const activeIncidents = incidents.filter(
        (i) => !["resolved", "closed"].includes(i.status)
      );

      const simplifiedIncidents = activeIncidents.map((inc) => ({
        incidentId: inc.incidentId,
        title: inc.title,
        priority: inc.priority,
        status: inc.status,
        category: inc.category,
        location: inc.location?.building,
        assignedAt: inc.updatedAt || inc.createdAt
      }));

      enrichedWorkers.push({
        userId: worker.userId,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        specialty: worker.specialty || "General",
        department: worker.department || "Mantenimiento",

        activeIncidents: simplifiedIncidents.length,
        workloadPoints: workload,
        maxWorkloadPoints: worker.maxWorkloadPoints || 20,
        status: workerStatus,

        currentIncidents: simplifiedIncidents,

        stats: {
          totalResolved: worker.totalResolved || 0,
          avgResolutionTimeHours: Math.round((worker.avgResolutionTimeHours || 0) * 100) / 100,
          rating: Math.round((worker.rating || 0) * 10) / 10
        }
      });
    }

    // 6. Ordenar
    const sorted = sortWorkers(enrichedWorkers, sortBy, order);

    // 7. Aplicar límite
    const finalWorkers = sorted.slice(0, limit);

    // 8. Convertir Decimals → float
    const cleanWorkers = decimalToFloat(finalWorkers);

    // 9. Preparar datos de respuesta
    const responseData = {
      workers: cleanWorkers,
      count: cleanWorkers.length,
      sortedBy: sortBy,
      order
    };

    if (statusFilter) {
      responseData.filteredBy = { status: statusFilter };
    }
    if (specialtyFilter) {
      if (!responseData.filteredBy) {
        responseData.filteredBy = {};
      }
      responseData.filteredBy.specialty = specialtyFilter;
    }

    // 10. Respuesta final
    return successResponse({
      message: `${cleanWorkers.length} trabajador(es) encontrado(s)`,
      data: responseData
    });

  } catch (err) {
    console.error("Error en list workers:", err);
    return internalError("Error al listar trabajadores: " + err.message);
  }
};
