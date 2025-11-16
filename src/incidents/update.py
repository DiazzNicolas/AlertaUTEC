"""
Lambda function: Actualizar incidente
Endpoint: PUT /incidents/{id}
Requiere: Autenticación

Permisos:
- Alumno: solo puede comentar en sus propios incidentes
- Worker: puede actualizar estado y comentar en incidentes asignados
- Admin: puede actualizar cualquier incidente
"""
import json
import os
import time
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, not_found, forbidden, internal_error
from utils.dynamodb import get_incident_by_id, update_item, INCIDENTS_TABLE, decimal_to_float
from utils.validators import UpdateIncidentSchema, validate_incident_status_transition, sanitize_string
from utils.auth import require_auth, can_update_incident, is_admin, is_worker, is_student
from pydantic import ValidationError


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Actualiza un incidente (estado, comentarios, prioridad)
    
    Request Body:
    {
        "status": "in_progress",         // Opcional
        "comment": "Iniciando reparación", // Opcional
        "priority": "high"                // Opcional (solo admin)
    }
    
    Response:
    {
        "success": true,
        "message": "Incidente actualizado exitosamente",
        "data": {
            "incidentId": "inc_xyz789",
            "status": "in_progress",
            "updatedAt": 1700010000000,
            "comment": {...}
        }
    }
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Obtener incidentId del path
        incident_id = event.get('pathParameters', {}).get('id')
        
        if not incident_id:
            return bad_request("ID de incidente no proporcionado")
        
        # Obtener incidente actual
        incident = get_incident_by_id(incident_id)
        
        if not incident:
            return not_found(f"Incidente {incident_id} no encontrado")
        
        # Verificar permisos
        if not can_update_incident(user, incident):
            return forbidden("No tienes permiso para actualizar este incidente")
        
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos
        try:
            update_data = UpdateIncidentSchema(**body)
        except ValidationError as e:
            errors = {}
            for error in e.errors():
                field = error['loc'][0]
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
        
        # Actualizar estado (solo workers y admins)
        if update_data.status:
            if is_student(user):
                return forbidden("Los estudiantes no pueden cambiar el estado")
            
            # Validar transición de estado
            if not validate_incident_status_transition(incident['status'], update_data.status):
                return bad_request(
                    f"Transición de estado inválida: {incident['status']} -> {update_data.status}",
                    details={
                        'currentStatus': incident['status'],
                        'requestedStatus': update_data.status,
                        'allowedTransitions': _get_allowed_transitions(incident['status'])
                    }
                )
            
            update_parts.append('#status = :status')
            expression_values[':status'] = update_data.status
            expression_names['#status'] = 'status'
            
            # Si se marca como resuelto, guardar timestamp
            if update_data.status == 'resolved' and not incident.get('resolvedAt'):
                update_parts.append('resolvedAt = :resolvedAt')
                expression_values[':resolvedAt'] = current_timestamp
        
        # Actualizar prioridad (solo admins)
        if update_data.priority:
            if not is_admin(user):
                return forbidden("Solo los administradores pueden cambiar la prioridad")
            
            update_parts.append('priority = :priority')
            expression_values[':priority'] = update_data.priority
        
        # Agregar comentario
        new_comment = None
        if update_data.comment:
            comment_text = sanitize_string(update_data.comment)
            
            new_comment = {
                'userId': user['userId'],
                'userName': user['name'],
                'userRole': user['role'],
                'comment': comment_text,
                'timestamp': current_timestamp
            }
            
            # Obtener comentarios actuales y agregar el nuevo
            current_comments = incident.get('comments', [])
            updated_comments = current_comments + [new_comment]
            
            update_parts.append('comments = :comments')
            expression_values[':comments'] = updated_comments
        
        # Siempre actualizar updatedAt
        update_parts.append('updatedAt = :updatedAt')
        
        # Ejecutar actualización
        if update_parts:
            update_expression = 'SET ' + ', '.join(update_parts)
            
            updated_incident = update_item(
                INCIDENTS_TABLE,
                key={'incidentId': incident_id},
                update_expression=update_expression,
                expression_values=expression_values,
                expression_names=expression_names if expression_names else None
            )
            
            # TODO: Enviar notificación WebSocket
            # broadcast_incident_update(updated_incident)
            
            # Preparar respuesta
            response_data = {
                'incidentId': incident_id,
                'status': updated_incident.get('status'),
                'priority': updated_incident.get('priority'),
                'updatedAt': updated_incident['updatedAt']
            }
            
            if new_comment:
                response_data['newComment'] = new_comment
            
            # Convertir Decimals
            response_data = decimal_to_float(response_data)
            
            return success_response(
                message="Incidente actualizado exitosamente",
                data=response_data
            )
        else:
            return bad_request("No hay datos para actualizar")
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en update incident: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al actualizar incidente: {str(e)}")


def _get_allowed_transitions(current_status: str) -> list:
    """Retorna las transiciones de estado permitidas"""
    transitions = {
        'pending': ['assigned'],
        'assigned': ['in_progress', 'pending'],
        'in_progress': ['resolved', 'assigned'],
        'resolved': ['closed', 'in_progress'],
        'closed': []
    }
    return transitions.get(current_status, [])