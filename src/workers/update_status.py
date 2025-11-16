"""
Lambda function: Actualizar estado y ubicación de trabajador
Endpoint: PUT /workers/{workerId}/status
Requiere: Autenticación (admin o el mismo worker)
"""
import json
import os
import time
from typing import Dict, Any, Optional

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, not_found, forbidden, internal_error
from utils.dynamodb import get_user_by_id, update_item, USERS_TABLE, decimal_to_float
from utils.validators import sanitize_string
from utils.auth import require_auth, is_admin
from pydantic import BaseModel, Field, ValidationError


class UpdateWorkerStatusSchema(BaseModel):
    """Esquema para actualizar estado del trabajador"""
    status: Optional[str] = Field(None, pattern=r'^(active|inactive|busy)$')
    lastLocation: Optional[Dict[str, Any]] = None
    notes: Optional[str] = Field(None, max_length=500)


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Actualiza el estado y ubicación de un trabajador
    
    Request Body:
    {
        "status": "active",  // active, inactive, busy
        "lastLocation": {
            "building": "Pabellón A",
            "floor": 3,
            "room": "302",
            "timestamp": 1700000000000
        },
        "notes": "Realizando mantenimiento en laboratorio"
    }
    
    Response:
    {
        "success": true,
        "message": "Estado actualizado exitosamente",
        "data": {
            "userId": "usr_worker123",
            "status": "active",
            "lastLocation": {...},
            "updatedAt": 1700000000000
        }
    }
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Obtener workerId del path
        worker_id = event.get('pathParameters', {}).get('workerId')
        
        if not worker_id:
            return bad_request("ID de trabajador no proporcionado")
        
        # Verificar permisos: admin o el mismo worker
        if not is_admin(user) and user['userId'] != worker_id:
            return forbidden("No tienes permiso para actualizar este trabajador")
        
        # Obtener trabajador actual
        worker = get_user_by_id(worker_id)
        
        if not worker:
            return not_found(f"Trabajador {worker_id} no encontrado")
        
        # Validar que sea un trabajador
        if worker.get('role') != 'worker':
            return bad_request("El usuario especificado no es un trabajador")
        
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos
        try:
            update_data = UpdateWorkerStatusSchema(**body)
        except ValidationError as e:
            errors = {}
            for error in e.errors():
                field = '.'.join(str(loc) for loc in error['loc'])
                errors[field] = error['msg']
            return bad_request(
                message="Datos de actualización inválidos",
                details=errors
            )
        
        current_timestamp = int(time.time() * 1000)
        
        # Construir expression de actualización
        update_parts = []
        expression_values = {':updatedAt': current_timestamp}
        expression_names = {}
        
        # Actualizar status
        if update_data.status:
            # Solo admin puede cambiar entre active/inactive
            if update_data.status in ['active', 'inactive'] and not is_admin(user):
                return forbidden("Solo administradores pueden activar/desactivar trabajadores")
            
            update_parts.append('#status = :status')
            expression_values[':status'] = update_data.status
            expression_names['#status'] = 'status'
        
        # Actualizar ubicación
        if update_data.lastLocation:
            location = update_data.lastLocation
            
            # Validar campos requeridos
            if not location.get('building'):
                return bad_request("El campo 'building' es requerido en lastLocation")
            
            location_data = {
                'building': sanitize_string(location['building']),
                'timestamp': current_timestamp
            }
            
            # Agregar campos opcionales
            if location.get('floor'):
                location_data['floor'] = location['floor']
            if location.get('room'):
                location_data['room'] = sanitize_string(location['room'])
            
            update_parts.append('lastLocation = :lastLocation')
            expression_values[':lastLocation'] = location_data
        
        # Actualizar notas
        if update_data.notes:
            notes_text = sanitize_string(update_data.notes)
            update_parts.append('notes = :notes')
            expression_values[':notes'] = notes_text
        
        # Siempre actualizar updatedAt
        update_parts.append('updatedAt = :updatedAt')
        
        # Ejecutar actualización
        if update_parts:
            update_expression = 'SET ' + ', '.join(update_parts)
            
            updated_worker = update_item(
                USERS_TABLE,
                key={'userId': worker_id},
                update_expression=update_expression,
                expression_values=expression_values,
                expression_names=expression_names if expression_names else None
            )
            
            # TODO: Enviar notificación WebSocket si el worker cambió de ubicación
            # notify_location_update(worker_id, update_data.lastLocation)
            
            # Preparar respuesta
            response_data = {
                'userId': worker_id,
                'name': updated_worker.get('name'),
                'specialty': updated_worker.get('specialty'),
                'status': updated_worker.get('status'),
                'updatedAt': updated_worker['updatedAt']
            }
            
            if updated_worker.get('lastLocation'):
                response_data['lastLocation'] = updated_worker['lastLocation']
            
            if updated_worker.get('notes'):
                response_data['notes'] = updated_worker['notes']
            
            # Convertir Decimals
            response_data = decimal_to_float(response_data)
            
            return success_response(
                message="Estado del trabajador actualizado exitosamente",
                data=response_data
            )
        else:
            return bad_request("No hay datos para actualizar")
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en update worker status: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al actualizar trabajador: {str(e)}")