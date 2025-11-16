"""
Lambda function: Manejar conexiones WebSocket
Route: $connect
"""
import os
import time
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.dynamodb import put_item, CONNECTIONS_TABLE
from utils.auth import decode_token, extract_token_from_header


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Maneja nuevas conexiones WebSocket
    
    Autentica al usuario mediante token JWT en query string y
    guarda la conexión en DynamoDB
    
    Query Parameters:
    - token: JWT token para autenticación
    
    Event structure:
    {
        "requestContext": {
            "connectionId": "abc123xyz",
            "routeKey": "$connect"
        },
        "queryStringParameters": {
            "token": "eyJhbGci..."
        }
    }
    
    Response:
    - 200: Conexión aceptada
    - 401: No autorizado (token inválido/ausente)
    """
    try:
        connection_id = event['requestContext']['connectionId']
        
        print(f"Nueva conexión WebSocket: {connection_id}")
        
        # Obtener token de query string
        query_params = event.get('queryStringParameters') or {}
        token = query_params.get('token')
        
        if not token:
            print("No se proporcionó token JWT")
            return {
                'statusCode': 401,
                'body': 'Unauthorized: Token requerido'
            }
        
        # Validar token JWT
        payload = decode_token(token)
        
        if not payload:
            print("Token inválido o expirado")
            return {
                'statusCode': 401,
                'body': 'Unauthorized: Token inválido'
            }
        
        # Extraer información del usuario
        user_id = payload.get('userId')
        role = payload.get('role')
        email = payload.get('email')
        name = payload.get('name')
        
        if not user_id or not role:
            print("Token no contiene información necesaria")
            return {
                'statusCode': 401,
                'body': 'Unauthorized: Token inválido'
            }
        
        current_timestamp = int(time.time() * 1000)
        ttl = int(time.time()) + 86400  # 24 horas
        
        # Guardar conexión en DynamoDB
        connection_item = {
            'connectionId': connection_id,
            'userId': user_id,
            'role': role,
            'email': email,
            'name': name,
            'connectedAt': current_timestamp,
            'ttl': ttl
        }
        
        put_item(CONNECTIONS_TABLE, connection_item)
        
        print(f"Conexión guardada: {connection_id} - User: {user_id} ({role})")
        
        return {
            'statusCode': 200,
            'body': 'Connected'
        }
    
    except KeyError as e:
        print(f"Error: Campo requerido faltante - {str(e)}")
        return {
            'statusCode': 400,
            'body': f'Bad Request: {str(e)}'
        }
    
    except Exception as e:
        print(f"Error en connect: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': 'Internal Server Error'
        }