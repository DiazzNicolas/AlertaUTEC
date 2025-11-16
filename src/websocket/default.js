/**
 * Lambda: Manejar mensajes WebSocket
 * Route: $default
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

/**
 * Handler principal para mensajes WebSocket ($default)
 * 
 * Maneja todos los mensajes que no coinciden con otras rutas específicas
 */
export const handler = async (event) => {
  try {
    console.log('=== WEBSOCKET $DEFAULT ===');
    console.log('Event:', JSON.stringify(event, null, 2));

    const connectionId = event.requestContext.connectionId;
    const body = event.body ? JSON.parse(event.body) : {};

    console.log('Message from:', connectionId);
    console.log('Body:', body);

    // Parsear el mensaje
    const action = body.action || 'unknown';
    
    let response;

    switch (action) {
      case 'ping':
        response = {
          type: 'pong',
          message: 'WebSocket activo',
          timestamp: Date.now()
        };
        break;

      case 'echo':
        response = {
          type: 'echo',
          data: body.data,
          timestamp: Date.now()
        };
        break;

      default:
        response = {
          type: 'error',
          message: `Acción desconocida: ${action}`,
          availableActions: ['ping', 'echo'],
          timestamp: Date.now()
        };
    }

    // Enviar respuesta al cliente
    const endpoint = WEBSOCKET_ENDPOINT.replace('wss://', 'https://');
    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint
    });

    await apiGateway.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(response)
      })
    );

    console.log('✅ Respuesta enviada');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message processed' })
    };

  } catch (err) {
    console.error('=== ERROR EN $DEFAULT ===');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Error processing message',
        error: err.message
      })
    };
  }
};