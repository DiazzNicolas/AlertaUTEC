"""
Lambda function: Registro de nuevos usuarios
Endpoint: POST /auth/register
"""
import json
import os
import time
import uuid
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, error_response, bad_request, conflict, internal_error, created
from utils.dynamodb import put_item, get_user_by_email, USERS_TABLE
from utils.validators import RegisterUserSchema, sanitize_string
from utils.auth import hash_password, generate_token
from pydantic import ValidationError


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Registra un nuevo usuario en el sistema
    
    Roles disponibles:
    - alumno: Estudiantes que reportan incidentes
    - worker: Personal de mantenimiento/técnico
    - admin: Administrador del sistema
    """
    try:
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos con Pydantic
        try:
            user_data = RegisterUserSchema(**body)
        except ValidationError as e:
            errors = {}
            for error in e.errors():
                field = error['loc'][0]
                errors[field] = error['msg']
            return bad_request(
                message="Datos de registro inválidos",
                details=errors
            )
        
        # Verificar si el email ya existe
        existing_user = get_user_by_email(user_data.email)
        if existing_user:
            return conflict(
                message="El correo electrónico ya está registrado",
                details={"email": "Este correo ya tiene una cuenta"}
            )
        
        # Generar ID único
        user_id = f"usr_{uuid.uuid4().hex[:12]}"
        current_timestamp = int(time.time() * 1000)
        
        # Hash de la contraseña
        hashed_password = hash_password(user_data.password)
        
        # Construir objeto de usuario base
        user_item = {
            'userId': user_id,
            'email': user_data.email.lower(),
            'password': hashed_password,
            'name': sanitize_string(user_data.name),
            'role': user_data.role,
            'phone': user_data.phone if user_data.phone else None,
            'createdAt': current_timestamp,
            'updatedAt': current_timestamp,
            'status': 'active'
        }
        
        # Agregar campos específicos según el rol
        if user_data.role == 'alumno':
            user_item.update({
                'studentCode': user_data.studentCode,
                'faculty': sanitize_string(user_data.faculty) if user_data.faculty else None,
                'career': sanitize_string(user_data.career) if user_data.career else None
            })
        
        elif user_data.role == 'worker':
            user_item.update({
                'specialty': sanitize_string(user_data.specialty) if user_data.specialty else 'General',
                'department': sanitize_string(user_data.department) if user_data.department else 'Mantenimiento',
                'workloadPoints': 0,
                'maxWorkloadPoints': 20,
                'activeIncidents': 0,
                'totalResolved': 0,
                'avgResolutionTimeHours': 0.0,
                'rating': 0.0
            })
        
        # Guardar en DynamoDB
        put_item(USERS_TABLE, user_item)
        
        # Generar token JWT
        token_data = {
            'userId': user_id,
            'email': user_item['email'],
            'role': user_item['role'],
            'name': user_item['name']
        }
        token = generate_token(token_data)
        
        # Preparar respuesta (sin contraseña)
        response_data = {
            'token': token,
            'user': {
                'userId': user_id,
                'email': user_item['email'],
                'name': user_item['name'],
                'role': user_item['role'],
                'phone': user_item.get('phone')
            }
        }
        
        # Agregar campos adicionales según el rol
        if user_data.role == 'alumno':
            response_data['user']['studentCode'] = user_item.get('studentCode')
            response_data['user']['faculty'] = user_item.get('faculty')
            response_data['user']['career'] = user_item.get('career')
        elif user_data.role == 'worker':
            response_data['user']['specialty'] = user_item.get('specialty')
            response_data['user']['department'] = user_item.get('department')
        
        return created(
            message="Usuario registrado exitosamente",
            data=response_data
        )
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en register: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al registrar usuario: {str(e)}")