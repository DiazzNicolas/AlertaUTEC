"""
Lambda function: Listar incidentes con filtros
Endpoint: GET /incidents
Requiere: Autenticación
"""
import json
import os
from typing import Dict, Any, Optional

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, internal_error
from utils.dynamodb import (
    query_items, scan_items, get_user_by_id, batch_get_items,
    INCIDENTS_TABLE, decimal_to_float
)
from utils.auth import require_auth, is_student, is_worker
from boto3.dynamodb.conditions import Key, Attr


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lista incidentes con filtros avanzados
    
    Query Parameters:
    - status: pending, assigned, in_progress, resolved, closed
    - priority: low, medium, high, urgent
    - category: electricidad, plomeria, etc.
    - assignedTo: userId del trabajador
    - building: nombre del edificio
    - limit: número de resultados (default: 50, max: 100)
    - lastKey: para paginación
    
    Examples:
    GET /incidents?status=pending
    GET /incidents?priority=urgent&building=Pabellón A
    GET /incidents?assignedTo=usr_worker123
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Obtener query parameters
        params = event.get('queryStringParameters') or {}
        
        status = params.get('status')
        priority = params.get('priority')
        category = params.get('category')
        assigned_to = params.get('assignedTo')
        building = params.get('building')
        limit = int(params.get('limit', 50))
        last_key_str = params.get('lastKey')
        
        # Validar límite
        if limit > 100:
            limit = 100
        
        # Parsear lastKey si existe
        last_key = None
        if last_key_str:
            try:
                last_key = json.loads(last_key_str)
            except:
                pass
        
        # Determinar qué incidentes puede ver el usuario
        incidents_result = None
        
        # Si es estudiante, solo ve sus propios incidentes
        if is_student(user):
            incidents_result = _get_student_incidents(
                user['userId'], 
                status, 
                limit, 
                last_key
            )
        
        # Si es trabajador, ve incidentes asignados a él + pendientes
        elif is_worker(user):
            if assigned_to and assigned_to != user['userId']:
                # Workers no pueden ver incidentes de otros workers
                assigned_to = user['userId']
            
            incidents_result = _get_worker_incidents(
                user['userId'],
                status,
                priority,
                category,
                building,
                limit,
                last_key
            )
        
        # Si es admin, ve todos los incidentes con filtros
        else:
            incidents_result = _get_filtered_incidents(
                status,
                priority,
                category,
                assigned_to,
                building,
                limit,
                last_key
            )
        
        # Obtener información de usuarios (reportedBy, assignedTo)
        incidents = incidents_result['items']
        enriched_incidents = _enrich_incidents_with_users(incidents)
        
        # Convertir Decimals a float/int
        enriched_incidents = decimal_to_float(enriched_incidents)
        
        # Preparar respuesta
        response_data = {
            'incidents': enriched_incidents,
            'count': len(enriched_incidents),
            'limit': limit
        }
        
        if incidents_result.get('lastEvaluatedKey'):
            response_data['lastEvaluatedKey'] = json.dumps(
                incidents_result['lastEvaluatedKey']
            )
        
        return success_response(
            message=f"{len(enriched_incidents)} incidente(s) encontrado(s)",
            data=response_data
        )
    
    except Exception as e:
        print(f"Error en list incidents: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al listar incidentes: {str(e)}")


def _get_student_incidents(
    student_id: str,
    status: Optional[str],
    limit: int,
    last_key: Optional[Dict]
) -> Dict[str, Any]:
    """Obtiene incidentes reportados por un estudiante"""
    filter_expr = Attr('reportedBy').eq(student_id)
    
    if status:
        filter_expr = filter_expr & Attr('status').eq(status)
    
    return scan_items(
        INCIDENTS_TABLE,
        filter_expression=filter_expr,
        limit=limit,
        last_evaluated_key=last_key
    )


def _get_worker_incidents(
    worker_id: str,
    status: Optional[str],
    priority: Optional[str],
    category: Optional[str],
    building: Optional[str],
    limit: int,
    last_key: Optional[Dict]
) -> Dict[str, Any]:
    """Obtiene incidentes para un trabajador (asignados + pendientes)"""
    
    # Si hay filtro de status específico
    if status:
        if status == 'pending':
            # Mostrar pendientes (para que pueda tomarlos)
            filter_expr = Attr('status').eq('pending')
        else:
            # Mostrar sus incidentes con ese status
            filter_expr = Attr('assignedTo').eq(worker_id) & Attr('status').eq(status)
    else:
        # Mostrar incidentes asignados a él O pendientes
        filter_expr = Attr('assignedTo').eq(worker_id) | Attr('status').eq('pending')
    
    # Agregar filtros adicionales
    if priority:
        filter_expr = filter_expr & Attr('priority').eq(priority)
    if category:
        filter_expr = filter_expr & Attr('category').eq(category)
    if building:
        filter_expr = filter_expr & Attr('location.building').eq(building)
    
    return scan_items(
        INCIDENTS_TABLE,
        filter_expression=filter_expr,
        limit=limit,
        last_evaluated_key=last_key
    )


def _get_filtered_incidents(
    status: Optional[str],
    priority: Optional[str],
    category: Optional[str],
    assigned_to: Optional[str],
    building: Optional[str],
    limit: int,
    last_key: Optional[Dict]
) -> Dict[str, Any]:
    """Obtiene incidentes con filtros (admin)"""
    
    # Si hay status, usar el índice StatusCreatedAtIndex
    if status:
        result = query_items(
            INCIDENTS_TABLE,
            key_condition=Key('status').eq(status),
            index_name='StatusCreatedAtIndex',
            limit=limit,
            scan_forward=False,
            last_evaluated_key=last_key
        )
        
        # Aplicar filtros adicionales
        items = result['items']
        if priority:
            items = [i for i in items if i.get('priority') == priority]
        if category:
            items = [i for i in items if i.get('category') == category]
        if assigned_to:
            items = [i for i in items if i.get('assignedTo') == assigned_to]
        if building:
            items = [i for i in items if i.get('location', {}).get('building') == building]
        
        result['items'] = items
        return result
    
    # Si hay assignedTo, usar el índice AssignedToIndex
    elif assigned_to:
        result = query_items(
            INCIDENTS_TABLE,
            key_condition=Key('assignedTo').eq(assigned_to),
            index_name='AssignedToIndex',
            limit=limit,
            scan_forward=False,
            last_evaluated_key=last_key
        )
        
        # Aplicar filtros adicionales
        items = result['items']
        if priority:
            items = [i for i in items if i.get('priority') == priority]
        if category:
            items = [i for i in items if i.get('category') == category]
        if building:
            items = [i for i in items if i.get('location', {}).get('building') == building]
        
        result['items'] = items
        return result
    
    # Si hay priority, usar el índice PriorityIndex
    elif priority:
        result = query_items(
            INCIDENTS_TABLE,
            key_condition=Key('priority').eq(priority),
            index_name='PriorityIndex',
            limit=limit,
            scan_forward=False,
            last_evaluated_key=last_key
        )
        
        # Aplicar filtros adicionales
        items = result['items']
        if category:
            items = [i for i in items if i.get('category') == category]
        if building:
            items = [i for i in items if i.get('location', {}).get('building') == building]
        
        result['items'] = items
        return result
    
    # Si solo hay filtros simples, hacer scan
    else:
        filter_expr = None
        
        if category:
            filter_expr = Attr('category').eq(category)
        if building:
            building_filter = Attr('location.building').eq(building)
            filter_expr = building_filter if not filter_expr else filter_expr & building_filter
        
        return scan_items(
            INCIDENTS_TABLE,
            filter_expression=filter_expr,
            limit=limit,
            last_evaluated_key=last_key
        )


def _enrich_incidents_with_users(incidents: list) -> list:
    """Agrega información de usuarios (reportedBy, assignedTo) a los incidentes"""
    
    if not incidents:
        return []
    
    # Recolectar todos los user IDs únicos
    user_ids = set()
    for incident in incidents:
        if incident.get('reportedBy'):
            user_ids.add(incident['reportedBy'])
        if incident.get('assignedTo'):
            user_ids.add(incident['assignedTo'])
    
    # Obtener usuarios en batch
    users = {}
    if user_ids:
        keys = [{'userId': uid} for uid in user_ids]
        from utils.dynamodb import USERS_TABLE
        user_items = batch_get_items(USERS_TABLE, keys)
        users = {u['userId']: u for u in user_items}
    
    # Enriquecer incidentes
    enriched = []
    for incident in incidents:
        enriched_incident = incident.copy()
        
        # Agregar info del reportador
        reported_by_id = incident.get('reportedBy')
        if reported_by_id and reported_by_id in users:
            reporter = users[reported_by_id]
            enriched_incident['reportedBy'] = {
                'userId': reporter['userId'],
                'name': reporter.get('name'),
                'email': reporter.get('email'),
                'studentCode': reporter.get('studentCode')
            }
        
        # Agregar info del trabajador asignado
        assigned_to_id = incident.get('assignedTo')
        if assigned_to_id and assigned_to_id in users:
            worker = users[assigned_to_id]
            enriched_incident['assignedTo'] = {
                'userId': worker['userId'],
                'name': worker.get('name'),
                'email': worker.get('email'),
                'specialty': worker.get('specialty'),
                'workloadPoints': worker.get('workloadPoints', 0)
            }
        
        enriched.append(enriched_incident)
    
    return enriched