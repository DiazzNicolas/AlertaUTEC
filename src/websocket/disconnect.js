/**
 * Lambda: Manejar desconexiones WebSocket
 * Route: $disconnect
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/**
 * Handler principal para desconexiones WebSocket ($disconnect)
 * 
 * Elimina la conexión de la tabla de DynamoDB cuando el cliente se desconecta
 */
export const handler = async (event) => {
  try {
    console.log('=== WEBSOCKET $DISCONNECT ===');

    const connectionId = event.requestContext.connectionId;
    console.log('Desconectando:', connectionId);

    // Eliminar conexión de DynamoDB
    await ddb.send(
      new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: {
          connectionId
        }
      })
    );

    console.log(`✅ Conexión eliminada: ${connectionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected' })
    };

  } catch (err) {
    console.error('=== ERROR EN $DISCONNECT ===');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    // Retornar 200 de todas formas porque ya se desconectó
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected with errors' })
    };
  }
};