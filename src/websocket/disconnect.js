/**
 * Lambda function: Manejar desconexiones WebSocket
 * Route: $disconnect
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/* ============================================================
   HANDLER PRINCIPAL ($disconnect)
   ============================================================*/
export const handler = async (event, context) => {
  try {
    const connectionId = event.requestContext.connectionId;

    console.log("Desconexión WebSocket:", connectionId);

    // 1. Obtener conexión antes de eliminar, para logs
    let connectionData = null;

    try {
      const result = await ddb.send(
        new GetCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId }
        })
      );
      connectionData = result.Item;
    } catch (err) {
      console.log("Error obteniendo conexión:", err.message);
    }

    if (connectionData) {
      const userId = connectionData.userId;
      const role = connectionData.role;

      console.log(`Desconectando usuario: ${userId} (${role})`);
    } else {
      console.log(`Conexión ${connectionId} no encontrada en DynamoDB`);
    }

    // 2. Eliminar conexión de DynamoDB
    await ddb.send(
      new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId }
      })
    );

    console.log(`Conexión eliminada: ${connectionId}`);

    return {
      statusCode: 200,
      body: "Disconnected",
    };

  } catch (err) {
    console.error("Error en disconnect:", err);

    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
};



// """
// Lambda function: Manejar desconexiones WebSocket
// Route: $disconnect
// """
// import os
// from typing import Dict, Any

// # Importar utilidades
// import sys
// sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

// from utils.dynamodb import delete_item, get_item, CONNECTIONS_TABLE


// def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
//     """
//     Maneja desconexiones WebSocket
    
//     Elimina la conexión de DynamoDB cuando un cliente se desconecta
    
//     Event structure:
//     {
//         "requestContext": {
//             "connectionId": "abc123xyz",
//             "routeKey": "$disconnect"
//         }
//     }
    
//     Response:
//     - 200: Desconexión procesada exitosamente
//     """
//     try:
//         connection_id = event['requestContext']['connectionId']
        
//         print(f"Desconexión WebSocket: {connection_id}")
        
//         # Obtener información de la conexión antes de eliminarla (para logs)
//         connection = get_item(CONNECTIONS_TABLE, {'connectionId': connection_id})
        
//         if connection:
//             user_id = connection.get('userId')
//             role = connection.get('role')
//             print(f"Desconectando usuario: {user_id} ({role})")
//         else:
//             print(f"Conexión {connection_id} no encontrada en DynamoDB")
        
//         # Eliminar conexión de DynamoDB
//         delete_item(CONNECTIONS_TABLE, {'connectionId': connection_id})
        
//         print(f"Conexión eliminada: {connection_id}")
        
//         return {
//             'statusCode': 200,
//             'body': 'Disconnected'
//         }
    
//     except KeyError as e:
//         print(f"Error: Campo requerido faltante - {str(e)}")
//         return {
//             'statusCode': 400,
//             'body': f'Bad Request: {str(e)}'
//         }
    
//     except Exception as e:
//         print(f"Error en disconnect: {str(e)}")
//         import traceback
//         traceback.print_exc()
//         return {
//             'statusCode': 500,
//             'body': 'Internal Server Error'
//         }