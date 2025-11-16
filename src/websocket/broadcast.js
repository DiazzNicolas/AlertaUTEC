/**
 * Lambda: Enviar mensajes broadcast a usuarios conectados
 * 
 * Esta función no está conectada a un evento directo,
 * se invoca desde otras lambdas para notificar a usuarios
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

/**
 * Envía un mensaje a una conexión específica
 */
async function sendToConnection(connectionId, message) {
  const endpoint = WEBSOCKET_ENDPOINT.replace('wss://', 'https://');
  const apiGateway = new ApiGatewayManagementApiClient({ endpoint });

  try {
    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message)
      })
    );
    return { success: true, connectionId };
  } catch (err) {
    console.error(`Error enviando a ${connectionId}:`, err.message);
    
    // Si la conexión está cerrada, eliminarla de DynamoDB
    if (err.statusCode === 410) {
      console.log(`Eliminando conexión obsoleta: ${connectionId}`);
      await ddb.send(
        new DeleteCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId }
        })
      );
    }
    
    return { success: false, connectionId, error: err.message };
  }
}

/**
 * Obtiene todas las conexiones activas
 */
async function getAllConnections() {
  const result = await ddb.send(
    new ScanCommand({
      TableName: CONNECTIONS_TABLE
    })
  );
  return result.Items || [];
}

/**
 * Obtiene conexiones por rol
 */
async function getConnectionsByRole(role) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RoleIndex',
      KeyConditionExpression: '#role = :role',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': role
      }
    })
  );
  return result.Items || [];
}

/**
 * Obtiene conexiones de un usuario específico
 */
async function getConnectionsByUserId(userId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    })
  );
  return result.Items || [];
}

/**
 * Handler principal para broadcasts
 * 
 * Event structure:
 * {
 *   "action": "broadcast",
 *   "target": "all" | "role" | "user",
 *   "targetValue": "admin" | "userId123",  // Solo para role/user
 *   "message": { ... }
 * }
 */
export const handler = async (event) => {
  try {
    console.log('=== WEBSOCKET BROADCAST ===');
    console.log('Event:', JSON.stringify(event, null, 2));

    const { action, target, targetValue, message } = event;

    if (!message) {
      throw new Error('Message is required');
    }

    let connections = [];

    // Obtener conexiones según el target
    switch (target) {
      case 'all':
        connections = await getAllConnections();
        console.log(`Enviando a todas las conexiones (${connections.length})`);
        break;

      case 'role':
        if (!targetValue) {
          throw new Error('targetValue (role) is required');
        }
        connections = await getConnectionsByRole(targetValue);
        console.log(`Enviando a rol ${targetValue} (${connections.length} conexiones)`);
        break;

      case 'user':
        if (!targetValue) {
          throw new Error('targetValue (userId) is required');
        }
        connections = await getConnectionsByUserId(targetValue);
        console.log(`Enviando a usuario ${targetValue} (${connections.length} conexiones)`);
        break;

      default:
        throw new Error(`Target inválido: ${target}`);
    }

    if (connections.length === 0) {
      console.log('⚠️ No hay conexiones activas para el target especificado');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No active connections',
          sent: 0
        })
      };
    }

    // Enviar mensaje a todas las conexiones
    const results = await Promise.allSettled(
      connections.map(conn => sendToConnection(conn.connectionId, message))
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    console.log(`✅ Mensajes enviados: ${successful}/${connections.length}`);
    if (failed > 0) {
      console.log(`⚠️ Fallos: ${failed}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Broadcast completed',
        total: connections.length,
        sent: successful,
        failed
      })
    };

  } catch (err) {
    console.error('=== ERROR EN BROADCAST ===');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error broadcasting message',
        error: err.message
      })
    };
  }
};

/**
 * Función auxiliar para notificar nuevo incidente a administradores
 * Puede ser llamada desde otras lambdas
 */
export async function notifyNewIncident(incidentData) {
  return handler({
    action: 'broadcast',
    target: 'role',
    targetValue: 'admin',
    message: {
      type: 'NEW_INCIDENT',
      data: incidentData,
      timestamp: Date.now()
    }
  });
}

/**
 * Función auxiliar para notificar asignación a un worker
 */
export async function notifyIncidentAssigned(workerId, incidentData) {
  return handler({
    action: 'broadcast',
    target: 'user',
    targetValue: workerId,
    message: {
      type: 'INCIDENT_ASSIGNED',
      data: incidentData,
      timestamp: Date.now()
    }
  });
}

/**
 * Función auxiliar para notificar actualización de incidente
 */
export async function notifyIncidentUpdated(incidentData) {
  return handler({
    action: 'broadcast',
    target: 'all',
    message: {
      type: 'INCIDENT_UPDATED',
      data: incidentData,
      timestamp: Date.now()
    }
  });
}