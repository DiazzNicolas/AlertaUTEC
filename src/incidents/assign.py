"""
Lambda function: Asignar trabajador a incidente
Endpoint: POST /incidents/{id}/assign
Requiere: Autenticación (solo admin)
"""
import json
import os
import time
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, not_found, forbidden, internal_error
from utils.dynamodb import (
    get_incident_by_id, get_user_by_id, update_item,
    INCIDENTS_TABLE, USERS_TABLE, decimal_to_float
)
from utils.validators import (
    AssignIncidentSchema, validate_worker_capacity,
    validate_priority_points, get_worker_status
)
from utils.auth import require_auth, can_assign_incident
from pydantic import ValidationError


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Asigna un trabajador a un incidente (asignación manual por admin)
    
    Request Body:
    {
        "workerId": "usr_worker123"
    }
    
    Response:
    {
        "success": true,
        "message": "Trabajador asignado exitosamente",
        "data": {
            "incidentId": "inc_xyz789",
            "assignedTo": "usr_worker123",
            "workerName": "Carlos López",
            "workerSpecialty": "Electricista",
            "status": "assigned",
            "updatedAt": 1700010000000,
            "workerNewWorkload": 8
        }
    }
    
    Validaciones:
    - Solo administradores pueden asignar
    - El trabajador debe existir y estar activo
    - El trabajador no debe exceder su capacidad máxima (20 puntos)
    - El incidente debe estar en estado 'pending' o 'assigned'
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Verificar permisos (solo admin puede asignar)
        if not can_assign_incident(user):
            return forbidden("Solo los administradores pueden asignar incidentes")
        
        # Obtener incidentId del path
        incident_id = event.get('pathParameters', {}).get('id')
        
        if not incident_id:
            return bad_request("ID de incidente no proporcionado")
        
        # Obtener incidente actual
        incident = get_incident_by_id(incident_id)
        
        if not incident:
            return not_found(f"Incidente {incident_id} no encontrado")
        
        # Validar que el incidente pueda ser asignado
        if incident['status'] not in ['pending', 'assigned']:
            return bad_request(
                f"No se puede asignar un incidente en estado '{incident['status']}'",
                details={'currentStatus': incident['status']}
            )
        
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos
        try:
            assign_data = AssignIncidentSchema(**body)
        except ValidationError as e:
            errors = {}
            for error in e.errors():
                field = error['loc'][0]
                errors[field] = error['msg']
            return bad_request(
                message="Datos de asignación inválidos",
                details=errors
            )
        
        # Obtener trabajador
        worker = get_user_by_id(assign_data.workerId)
        
        if not worker:
            return not_found(f"Trabajador {assign_data.workerId} no encontrado")
        
        # Validar que sea un trabajador
        if worker['role'] != 'worker':
            return bad_request(
                f"El usuario {assign_data.workerId} no es un trabajador",
                details={'role': worker['role']}
            )
        
        # Validar que el trabajador esté activo
        if worker.get('status') != 'active':
            return bad_request(
                f"El trabajador está inactivo",
                details={'workerStatus': worker.get('status')}
            )
        
        # Validar capacidad del trabajador
        current_workload = worker.get('workloadPoints', 0)
        incident_priority = incident['priority']
        
        if not validate_worker_capacity(current_workload, incident_priority):
            priority_points = validate_priority_points(incident_priority)
            return bad_request(
                f"El trabajador ha excedido su capacidad máxima",
                details={
                    'currentWorkload': current_workload,
                    'incidentPoints': priority_points,
                    'maxWorkload': 20,
                    'wouldBe': current_workload + priority_points
                }
            )
        
        current_timestamp = int(time.time() * 1000)
        
        # Si ya estaba asignado a otro trabajador, liberar su carga
        old_worker_id = incident.get('assignedTo')
        if old_worker_id and old_worker_id != assign_data.workerId:
            old_worker = get_user_by_id(old_worker_id)
            if old_worker:
                old_points = validate_priority_points(incident_priority)
                _update_worker_workload(
                    old_worker_id,
                    old_worker.get('workloadPoints', 0) - old_points,
                    old_worker.get('activeIncidents', 0) - 1
                )
        
        # Actualizar incidente
        updated_incident = update_item(
            INCIDENTS_TABLE,
            key={'incidentId': incident_id},
            update_expression='SET assignedTo = :workerId, #status = :status, updatedAt = :updatedAt',
            expression_values={
                ':workerId': assign_data.workerId,
                ':status': 'assigned',
                ':updatedAt': current_timestamp
            },
            expression_names={'#status': 'status'}
        )
        
        # Actualizar carga del trabajador
        priority_points = validate_priority_points(incident_priority)
        new_workload = current_workload + priority_points
        new_active_incidents = worker.get('activeIncidents', 0) + 1
        
        _update_worker_workload(assign_data.workerId, new_workload, new_active_incidents)
        
        # TODO: Enviar notificación WebSocket al trabajador
        # notify_worker_assignment(assign_data.workerId, incident)
        
        # TODO: Enviar notificación al estudiante que reportó
        # notify_student_assignment(incident['reportedBy'], worker, incident)
        
        # Preparar respuesta
        response_data = {
            'incidentId': incident_id,
            'assignedTo': assign_data.workerId,
            'workerName': worker['name'],
            'workerSpecialty': worker.get('specialty'),
            'workerDepartment': worker.get('department'),
            'status': 'assigned',
            'updatedAt': current_timestamp,
            'workerNewWorkload': new_workload,
            'workerStatus': get_worker_status(new_workload)
        }
        
        # Convertir Decimals
        response_data = decimal_to_float(response_data)
        
        return success_response(
            message="Trabajador asignado exitosamente",
            data=response_data
        )
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en assign incident: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al asignar trabajador: {str(e)}")


def _update_worker_workload(worker_id: str, new_workload: int, new_active_incidents: int):
    """Actualiza la carga de trabajo de un trabajador"""
    try:
        update_item(
            USERS_TABLE,
            key={'userId': worker_id},
            update_expression='SET workloadPoints = :workload, activeIncidents = :active, #status = :status, updatedAt = :updatedAt',
            expression_values={
                ':workload': new_workload,
                ':active': new_active_incidents,
                ':status': get_worker_status(new_workload),
                ':updatedAt': int(time.time() * 1000)
            },
            expression_names={'#status': 'status'}
        )
    except Exception as e:
        print(f"Error actualizando carga del trabajador {worker_id}: {str(e)}")