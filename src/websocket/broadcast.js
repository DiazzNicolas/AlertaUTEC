




/**
 * Lambda: Enviar mensajes broadcast via WebSocket
 * Esta Lambda puede ser invocada por WebSocket o por otras Lambdas.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { Key } from "aws-sdk/clients/dynamodb"; // Solo si usas KeyConditionExpression con abreviación
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Tablas
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

// WebSocket endpoint
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || "";
let apiClient = null;

if (WEBSOCKET_ENDPOINT) {
  const endpoint = WEBSOCKET_ENDPOINT.replace("wss://", "https://");
  apiClient = new ApiGatewayManagementApiClient({
    endpoint,
  });
}

/* ============================================================
   HANDLER PRINCIPAL
   ============================================================*/
export const handler = async (event) => {
  try {
    console.log("Broadcast event:", JSON.stringify(event));

    if (event.requestContext) {
      // mensaje enviado desde un cliente WebSocket
      return await handleWebsocketMessage(event);
    } else {
      // invocación directa desde otra Lambda
      return await handleBroadcastRequest(event);
    }
  } catch (err) {
    console.error("Error en broadcast:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

/* ============================================================
   FUNCIONES: WebSocket Entrante (ping/pong)
   ============================================================*/
async function handleWebsocketMessage(event) {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || "{}");
    const action = body.action || "";

    console.log("WebSocket message from", connectionId, ":", action);

    if (action === "ping") {
      await sendToConnection(connectionId, {
        type: "PONG",
        timestamp: Date.now(),
      });

      return { statusCode: 200, body: "Pong sent" };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Message received" }),
    };
  } catch (err) {
    console.error("Error handling WebSocket message:", err);
    return { statusCode: 500, body: "Error" };
  }
}

/* ============================================================
   FUNCIONES: Broadcast desde otras Lambdas
   ============================================================*/
async function handleBroadcastRequest(event) {
  try {
    const message = event.message;
    const targetRoles = event.targetRoles || [];
    const targetUsers = event.targetUsers || [];

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Message is required" }),
      };
    }

    const connections = await getTargetConnections(targetRoles, targetUsers);

    if (!connections.length) {
      console.log("No hay conexiones activas");
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No active connections", sent: 0 }),
      };
    }

    let sent = 0;
    let failed = 0;

    for (const conn of connections) {
      const ok = await sendToConnection(conn.connectionId, message);
      if (ok) sent++;
      else failed++;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Broadcast sent",
        sent,
        failed,
        total: connections.length,
      }),
    };
  } catch (err) {
    console.error("Error en broadcast request:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/* ============================================================
   CONSULTA DE CONEXIONES
   ============================================================*/
async function getTargetConnections(targetRoles = [], targetUsers = []) {
  let items = [];

  // Filtrar por usuarios
  if (targetUsers?.length) {
    for (const userId of targetUsers) {
      const result = await ddb.send(
        new QueryCommand({
          TableName: CONNECTIONS_TABLE,
          IndexName: "UserIdIndex",
          KeyConditionExpression: "userId = :u",
          ExpressionAttributeValues: {
            ":u": userId,
          },
        })
      );
      items.push(...result.Items);
    }
  }

  // Filtrar por roles
  else if (targetRoles?.length) {
    for (const role of targetRoles) {
      const result = await ddb.send(
        new QueryCommand({
          TableName: CONNECTIONS_TABLE,
          IndexName: "RoleIndex",
          KeyConditionExpression: "role = :r",
          ExpressionAttributeValues: {
            ":r": role,
          },
        })
      );
      items.push(...result.Items);
    }
  }

  // No hay filtros → scan
  else {
    const result = await ddb.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
      })
    );
    items = result.Items;
  }

  return items;
}

/* ============================================================
   ENVIAR MENSAJE A UNA CONEXIÓN
   ============================================================*/
async function sendToConnection(connectionId, message) {
  try {
    if (!apiClient) {
      console.error("API Gateway client not initialized");
      return false;
    }

    await apiClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      })
    );

    console.log("Mensaje enviado a", connectionId);
    return true;
  } catch (err) {
    // Conexión cerrada → eliminarla
    if (err.name === "GoneException") {
      console.log("Conexión expirada:", connectionId);

      await ddb.send(
        new DeleteCommand({
          TableName: CONNECTIONS_TABLE,
          Key: {
            connectionId,
          },
        })
      );

      return false;
    }

    console.error("Error enviando a", connectionId, ":", err);
    return false;
  }
}




// # """
// # Lambda function: Enviar mensajes broadcast via WebSocket
// # Esta función es invocada por otras Lambdas para enviar notificaciones
// # """
// # import os
// # import json
// # import boto3
// # from typing import Dict, Any, List, Optional
// # import time
// # # Importar utilidades
// # import sys
// # sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

// # from utils.dynamodb import query_items, scan_items, CONNECTIONS_TABLE
// # from boto3.dynamodb.conditions import Key


// # # Cliente API Gateway Management
// # WEBSOCKET_ENDPOINT = os.environ.get('WEBSOCKET_ENDPOINT', '')
// # api_gateway_management = None

// # if WEBSOCKET_ENDPOINT:
// #     # Remover protocolo wss:// y agregar https://
// #     endpoint = WEBSOCKET_ENDPOINT.replace('wss://', 'https://')
// #     api_gateway_management = boto3.client(
// #         'apigatewaymanagementapi',
// #         endpoint_url=endpoint
// #     )


// # def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
// #     """
// #     Envía mensajes broadcast a usuarios conectados via WebSocket
    
// #     Esta función puede ser invocada de dos formas:
    
// #     1. Directamente desde otras Lambdas (invoke):
// #     {
// #         "action": "broadcast",
// #         "message": {
// #             "type": "NEW_INCIDENT",
// #             "data": {...}
// #         },
// #         "targetRoles": ["admin", "worker"],  // Opcional
// #         "targetUsers": ["usr_123", "usr_456"]  // Opcional
// #     }
    
// #     2. Via WebSocket route (desde cliente):
// #     {
// #         "action": "ping"
// #     }
    
// #     Types de mensajes:
// #     - NEW_INCIDENT: Nuevo incidente creado
// #     - INCIDENT_ASSIGNED: Incidente asignado a worker
// #     - INCIDENT_UPDATED: Estado de incidente actualizado
// #     - INCIDENT_RESOLVED: Incidente resuelto
// #     """
// #     try:
// #         print(f"Broadcast event: {json.dumps(event)}")
        
// #         # Verificar si es invocación directa o via WebSocket route
// #         if 'requestContext' in event:
// #             # Invocación via WebSocket (cliente)
// #             return handle_websocket_message(event)
// #         else:
// #             # Invocación directa (desde otra Lambda)
// #             return handle_broadcast_request(event)
    
// #     except Exception as e:
// #         print(f"Error en broadcast: {str(e)}")
// #         import traceback
// #         traceback.print_exc()
// #         return {
// #             'statusCode': 500,
// #             'body': json.dumps({'error': str(e)})
// #         }


// # def handle_websocket_message(event: Dict[str, Any]) -> Dict[str, Any]:
// #     """
// #     Maneja mensajes recibidos via WebSocket desde clientes
// #     (Por ejemplo, un ping/pong para keep-alive)
// #     """
// #     try:
// #         connection_id = event['requestContext']['connectionId']
        
// #         # Parsear body
// #         body = json.loads(event.get('body', '{}'))
// #         action = body.get('action', '')
        
// #         print(f"WebSocket message from {connection_id}: {action}")
        
// #         # Ping/Pong para keep-alive
// #         if action == 'ping':
// #             send_to_connection(connection_id, {
// #                 'type': 'PONG',
// #                 'timestamp': int(time.time() * 1000)
// #             })
// #             return {'statusCode': 200, 'body': 'Pong sent'}
        
// #         # Otros mensajes pueden ser manejados aquí
// #         return {
// #             'statusCode': 200,
// #             'body': json.dumps({'message': 'Message received'})
// #         }
    
// #     except Exception as e:
// #         print(f"Error handling WebSocket message: {str(e)}")
// #         return {'statusCode': 500, 'body': 'Error'}


// # def handle_broadcast_request(event: Dict[str, Any]) -> Dict[str, Any]:
// #     """
// #     Maneja requests de broadcast desde otras Lambdas
// #     """
// #     try:
// #         message = event.get('message')
// #         target_roles = event.get('targetRoles', [])
// #         target_users = event.get('targetUsers', [])
        
// #         if not message:
// #             return {
// #                 'statusCode': 400,
// #                 'body': json.dumps({'error': 'Message is required'})
// #             }
        
// #         # Obtener conexiones target
// #         connections = get_target_connections(target_roles, target_users)
        
// #         if not connections:
// #             print("No hay conexiones activas para enviar")
// #             return {
// #                 'statusCode': 200,
// #                 'body': json.dumps({
// #                     'message': 'No active connections',
// #                     'sent': 0
// #                 })
// #             }
        
// #         # Enviar mensaje a todas las conexiones
// #         sent_count = 0
// #         failed_count = 0
        
// #         for connection in connections:
// #             connection_id = connection['connectionId']
// #             success = send_to_connection(connection_id, message)
            
// #             if success:
// #                 sent_count += 1
// #             else:
// #                 failed_count += 1
        
// #         print(f"Broadcast completado: {sent_count} enviados, {failed_count} fallidos")
        
// #         return {
// #             'statusCode': 200,
// #             'body': json.dumps({
// #                 'message': 'Broadcast sent',
// #                 'sent': sent_count,
// #                 'failed': failed_count,
// #                 'total': len(connections)
// #             })
// #         }
    
// #     except Exception as e:
// #         print(f"Error en broadcast request: {str(e)}")
// #         return {
// #             'statusCode': 500,
// #             'body': json.dumps({'error': str(e)})
// #         }


// # def get_target_connections(
// #     target_roles: List[str] = None,
// #     target_users: List[str] = None
// # ) -> List[Dict[str, Any]]:
// #     """
// #     Obtiene las conexiones activas según los filtros
    
// #     Args:
// #         target_roles: Lista de roles (admin, worker, alumno)
// #         target_users: Lista de userIds específicos
    
// #     Returns:
// #         Lista de conexiones activas
// #     """
// #     connections = []
    
// #     # Si hay usuarios específicos, obtenerlos directamente
// #     if target_users:
// #         for user_id in target_users:
// #             result = query_items(
// #                 CONNECTIONS_TABLE,
// #                 key_condition=Key('userId').eq(user_id),
// #                 index_name='UserIdIndex'
// #             )
// #             connections.extend(result.get('items', []))
    
// #     # Si hay roles específicos, obtenerlos por rol
// #     elif target_roles:
// #         for role in target_roles:
// #             result = query_items(
// #                 CONNECTIONS_TABLE,
// #                 key_condition=Key('role').eq(role),
// #                 index_name='RoleIndex'
// #             )
// #             connections.extend(result.get('items', []))
    
// #     # Si no hay filtros, obtener todas las conexiones
// #     else:
// #         result = scan_items(CONNECTIONS_TABLE)
// #         connections = result.get('items', [])
    
// #     return connections


// # def send_to_connection(connection_id: str, message: Dict[str, Any]) -> bool:
// #     """
// #     Envía un mensaje a una conexión WebSocket específica
    
// #     Args:
// #         connection_id: ID de la conexión
// #         message: Mensaje a enviar (será convertido a JSON)
    
// #     Returns:
// #         True si se envió exitosamente, False si falló
// #     """
// #     try:
// #         if not api_gateway_management:
// #             print("API Gateway Management client not initialized")
// #             return False
        
// #         # Convertir mensaje a JSON
// #         message_data = json.dumps(message, ensure_ascii=False, default=str)
        
// #         # Enviar mensaje
// #         api_gateway_management.post_to_connection(
// #             ConnectionId=connection_id,
// #             Data=message_data.encode('utf-8')
// #         )
        
// #         print(f"Mensaje enviado a {connection_id}")
// #         return True
    
// #     except api_gateway_management.exceptions.GoneException:
// #         # Conexión ya no existe, eliminar de DynamoDB
// #         print(f"Conexión {connection_id} ya no existe, eliminando...")
// #         from utils.dynamodb import delete_item
// #         delete_item(CONNECTIONS_TABLE, {'connectionId': connection_id})
// #         return False
    
// #     except Exception as e:
// #         print(f"Error enviando a {connection_id}: {str(e)}")
// #         return False


// # # Funciones helper para tipos de mensajes específicos

// # def broadcast_new_incident(incident: Dict[str, Any], reporter: Dict[str, Any]):
// #     """
// #     Notifica a admins sobre un nuevo incidente
// #     """
// #     message = {
// #         'type': 'NEW_INCIDENT',
// #         'incidentId': incident['incidentId'],
// #         'title': incident['title'],
// #         'priority': incident['priority'],
// #         'category': incident['category'],
// #         'location': incident.get('location', {}),
// #         'reportedBy': reporter,
// #         'timestamp': incident['createdAt']
// #     }
    
// #     # Invocar esta función para enviar a admins
// #     return handle_broadcast_request({
// #         'message': message,
// #         'targetRoles': ['admin']
// #     })


// # def broadcast_incident_assigned(incident: Dict[str, Any], worker: Dict[str, Any]):
// #     """
// #     Notifica al worker y al estudiante sobre la asignación
// #     """
// #     message = {
// #         'type': 'INCIDENT_ASSIGNED',
// #         'incidentId': incident['incidentId'],
// #         'workerId': worker['userId'],
// #         'workerName': worker.get('name'),
// #         'timestamp': int(time.time() * 1000)
// #     }
    
// #     # Enviar al worker y al estudiante que reportó
// #     target_users = [worker['userId']]
// #     if incident.get('reportedBy'):
// #         target_users.append(incident['reportedBy'])
    
// #     return handle_broadcast_request({
// #         'message': message,
// #         'targetUsers': target_users
// #     })


// # def broadcast_incident_updated(incident: Dict[str, Any]):
// #     """
// #     Notifica sobre actualización de estado
// #     """
// #     message = {
// #         'type': 'INCIDENT_UPDATED',
// #         'incidentId': incident['incidentId'],
// #         'status': incident['status'],
// #         'timestamp': incident.get('updatedAt')
// #     }
    
// #     # Enviar a admins y al usuario que reportó
// #     target_users = []
// #     if incident.get('reportedBy'):
// #         target_users.append(incident['reportedBy'])
// #     if incident.get('assignedTo'):
// #         target_users.append(incident['assignedTo'])
    
// #     return handle_broadcast_request({
// #         'message': message,
// #         'targetUsers': target_users,
// #         'targetRoles': ['admin']
// #     })


// # def broadcast_incident_resolved(incident: Dict[str, Any], worker: Dict[str, Any]):
// #     """
// #     Notifica sobre incidente resuelto
// #     """
// #     message = {
// #         'type': 'INCIDENT_RESOLVED',
// #         'incidentId': incident['incidentId'],
// #         'resolvedBy': worker['userId'],
// #         'timestamp': incident.get('resolvedAt')
// #     }
    
// #     # Enviar al estudiante que reportó y admins
// #     target_users = []
// #     if incident.get('reportedBy'):
// #         target_users.append(incident['reportedBy'])
    
// #     return handle_broadcast_request({
// #         'message': message,
// #         'targetUsers': target_users,
// #         'targetRoles': ['admin']
// #     })