/**
 * Lambda: Manejar conexiones WebSocket
 * Route: $connect
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Variables de entorno
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret';

/**
 * Handler principal para conexiones WebSocket ($connect)
 * 
 * Query Parameters esperados:
 * - token: JWT token para autenticación
 * 
 * Ejemplo: wss://endpoint.com/dev?token=eyJhbGci...
 */
export const handler = async (event) => {
  try {
    console.log('=== WEBSOCKET $CONNECT ===');
    console.log('Event:', JSON.stringify(event, null, 2));

    const connectionId = event.requestContext.connectionId;
    console.log('Connection ID:', connectionId);

    // Obtener token de querystring
    const queryParams = event.queryStringParameters || {};
    console.log('Query params:', queryParams);

    const token = queryParams.token;

    if (!token) {
      console.error('❌ Token no proporcionado');
      return {
        statusCode: 401,
        body: JSON.stringify({ 
          message: 'Unauthorized: Token requerido',
          error: 'NO_TOKEN'
        })
      };
    }

    // Validar token JWT
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
      console.log('✅ Token válido:', { userId: payload.userId, role: payload.role });
    } catch (err) {
      console.error('❌ Token inválido:', err.message);
      return {
        statusCode: 401,
        body: JSON.stringify({ 
          message: 'Unauthorized: Token inválido o expirado',
          error: 'INVALID_TOKEN'
        })
      };
    }

    const userId = payload.userId;
    const role = payload.role;
    const email = payload.email;
    const name = payload.name;

    if (!userId || !role) {
      console.error('❌ Token no contiene información necesaria');
      return {
        statusCode: 401,
        body: JSON.stringify({ 
          message: 'Unauthorized: Token no contiene información necesaria',
          error: 'INCOMPLETE_TOKEN'
        })
      };
    }

    const now = Date.now();
    const ttl = Math.floor(Date.now() / 1000) + 86400; // 24 horas

    const item = {
      connectionId,
      userId,
      role,
      email: email || null,
      name: name || 'Usuario',
      connectedAt: now,
      ttl
    };

    // Guardar conexión en DynamoDB
    console.log('Guardando conexión en DynamoDB...');
    await ddb.send(
      new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: item
      })
    );

    console.log(`✅ Conexión guardada exitosamente`);
    console.log(`   - ConnectionId: ${connectionId}`);
    console.log(`   - UserId: ${userId}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - Name: ${name}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Connected',
        connectionId,
        userId,
        role
      })
    };

  } catch (err) {
    console.error('=== ERROR EN $CONNECT ===');
    console.error('Tipo:', err.name);
    console.error('Mensaje:', err.message);
    console.error('Stack:', err.stack);

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Internal Server Error',
        error: err.message
      })
    };
  }
};