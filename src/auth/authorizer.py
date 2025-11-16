"""
Lambda Authorizer: Valida JWT tokens para proteger endpoints
Tipo: REQUEST authorizer
"""
import os
from typing import Dict, Any, Optional

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.auth import decode_token, extract_token_from_header


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda Authorizer para API Gateway
    
    Valida el token JWT y retorna una política de acceso IAM
    
    Event structure:
    {
        "type": "REQUEST",
        "methodArn": "arn:aws:execute-api:...",
        "headers": {
            "Authorization": "Bearer <token>"
        }
    }
    
    Returns:
    {
        "principalId": "user_id",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [...]
        },
        "context": {
            "userId": "...",
            "role": "...",
            "email": "..."
        }
    }
    """
    try:
        print(f"Authorizer event: {event}")
        
        # Extraer el token del header Authorization
        headers = event.get('headers', {})
        
        # Buscar Authorization header (case-insensitive)
        auth_header = None
        for key, value in headers.items():
            if key.lower() == 'authorization':
                auth_header = value
                break
        
        if not auth_header:
            print("No Authorization header found")
            raise Exception('Unauthorized')
        
        # Extraer token
        token = extract_token_from_header(auth_header)
        
        if not token:
            print("Invalid token format")
            raise Exception('Unauthorized')
        
        # Decodificar y validar token
        payload = decode_token(token)
        
        if not payload:
            print("Invalid or expired token")
            raise Exception('Unauthorized')
        
        # Extraer información del usuario
        user_id = payload.get('userId')
        role = payload.get('role')
        email = payload.get('email')
        name = payload.get('name')
        
        if not user_id or not role:
            print("Missing required fields in token")
            raise Exception('Unauthorized')
        
        print(f"Token validated for user: {user_id} ({role})")
        
        # Generar política de acceso
        policy = generate_policy(
            principal_id=user_id,
            effect='Allow',
            resource=event['methodArn'],
            context={
                'userId': user_id,
                'role': role,
                'email': email,
                'name': name
            }
        )
        
        return policy
    
    except Exception as e:
        print(f"Authorizer error: {str(e)}")
        # Retornar Deny si hay cualquier error
        raise Exception('Unauthorized')


def generate_policy(
    principal_id: str,
    effect: str,
    resource: str,
    context: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Genera una política de acceso IAM
    
    Args:
        principal_id: ID del usuario (principalId)
        effect: 'Allow' o 'Deny'
        resource: ARN del recurso (methodArn)
        context: Contexto adicional a pasar a la función Lambda
    
    Returns:
        Política IAM
    """
    auth_response = {
        'principalId': principal_id
    }
    
    if effect and resource:
        policy_document = {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource
                }
            ]
        }
        auth_response['policyDocument'] = policy_document
    
    # Agregar contexto (será accesible en las funciones Lambda)
    if context:
        # API Gateway requiere que todos los valores del contexto sean strings
        auth_response['context'] = {
            key: str(value) for key, value in context.items()
        }
    
    return auth_response


def generate_allow_policy(
    principal_id: str,
    resource: str,
    context: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Helper para generar política Allow"""
    return generate_policy(principal_id, 'Allow', resource, context)


def generate_deny_policy(
    principal_id: str,
    resource: str
) -> Dict[str, Any]:
    """Helper para generar política Deny"""
    return generate_policy(principal_id, 'Deny', resource)