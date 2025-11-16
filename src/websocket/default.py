"""
Lambda function: Manejar rutas por defecto de WebSocket
Route: $default
Captura cualquier mensaje que no tenga una ruta específica
"""
import json
from typing import Dict, Any


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Maneja mensajes WebSocket que no coinciden con ninguna ruta específica
    
    Event structure:
    {
        "requestContext": {
            "connectionId": "abc123xyz",
            "routeKey": "$default"
        },
        "body": "{\"action\": \"unknown\"}"
    }
    
    Response:
    - 200: Mensaje procesado (o ignorado)
    """
    try:
        connection_id = event['requestContext']['connectionId']
        route_key = event['requestContext'].get('routeKey', '$default')
        
        print(f"Default route called - Connection: {connection_id}, Route: {route_key}")
        
        # Parsear body si existe
        body = {}
        if event.get('body'):
            try:
                body = json.loads(event['body'])
            except json.JSONDecodeError:
                print(f"Invalid JSON in body: {event['body']}")
        
        action = body.get('action', 'unknown')
        
        print(f"Action received: {action}")
        print(f"Body: {json.dumps(body)}")
        
        # Log para debugging
        # En producción podrías manejar acciones específicas aquí
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Message received',
                'action': action
            })
        }
    
    except Exception as e:
        print(f"Error en default handler: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal Server Error'})
        }