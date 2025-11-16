"""
Lambda function: Inicio de sesión
Endpoint: POST /auth/login
"""
import json
import os
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, not_found, internal_error
from utils.dynamodb import get_user_by_email
from utils.validators import LoginSchema
from utils.auth import verify_password, generate_token
from pydantic import ValidationError


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Autentica un usuario y genera un token JWT
    
    Request Body:
    {
        "email": "juan.perez@universidad.edu.pe",
        "password": "Password123!"
    }
    
    Response:
    {
        "success": true,
        "message": "Login exitoso",
        "data": {
            "token": "eyJhbGci...",
            "user": {
                "userId": "usr_xxx",
                "email": "...",
                "name": "...",
                "role": "alumno"
            }
        }
    }
    """
    try:
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos con Pydantic
        try:
            login_data = LoginSchema(**body)
        except ValidationError as e:
            return bad_request(
                message="Datos de login inválidos",
                details={error['loc'][0]: error['msg'] for error in e.errors()}
            )
        
        # Buscar usuario por email
        user = get_user_by_email(login_data.email.lower())
        
        if not user:
            return not_found("Usuario no encontrado")
        
        # Verificar si el usuario está activo
        if user.get('status') != 'active':
            return unauthorized("Cuenta inactiva. Contacta al administrador")
        
        # Verificar contraseña
        if not verify_password(login_data.password, user['password']):
            return unauthorized("Credenciales inválidas")
        
        # Generar token JWT
        token_data = {
            'userId': user['userId'],
            'email': user['email'],
            'role': user['role'],
            'name': user['name']
        }
        token = generate_token(token_data)
        
        # Preparar datos del usuario (sin contraseña)
        user_response = {
            'userId': user['userId'],
            'email': user['email'],
            'name': user['name'],
            'role': user['role'],
            'phone': user.get('phone')
        }
        
        # Agregar campos específicos según el rol
        if user['role'] == 'alumno':
            user_response.update({
                'studentCode': user.get('studentCode'),
                'faculty': user.get('faculty'),
                'career': user.get('career')
            })
        elif user['role'] == 'worker':
            user_response.update({
                'specialty': user.get('specialty'),
                'department': user.get('department'),
                'workloadPoints': user.get('workloadPoints', 0),
                'activeIncidents': user.get('activeIncidents', 0),
                'status': _get_worker_status(user.get('workloadPoints', 0))
            })
        
        response_data = {
            'token': token,
            'user': user_response
        }
        
        return success_response(
            message="Login exitoso",
            data=response_data
        )
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en login: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al iniciar sesión: {str(e)}")


def _get_worker_status(workload_points: int) -> str:
    """Determina el estado del trabajador según su carga"""
    if workload_points <= 10:
        return 'available'
    elif workload_points <= 15:
        return 'moderate'
    else:
        return 'busy'