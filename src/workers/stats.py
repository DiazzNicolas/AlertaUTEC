"""
Lambda function: Obtener estadísticas detalladas de un trabajador
Endpoint: GET /workers/{workerId}/stats
Requiere: Autenticación (admin o el mismo worker)
"""
import json
import os
from typing import Dict, Any, List

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, unauthorized, not_found, forbidden, internal_error
from utils.dynamodb import (
    get_user_by_id, get_incidents_by_worker, query_items, decimal_to_float,
    INCIDENTS_TABLE
)
from utils.validators import get_worker_status, validate_priority_points
from utils.auth import require_auth, is_admin
from boto3.dynamodb.conditions import Key, Attr


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Obtiene estadísticas detalladas de un trabajador específico
    
    Path Parameters:
    - workerId: ID del trabajador
    
    Response:
    {
        "success": true,
        "data": {
            "worker": {
                "userId": "usr_worker123",
                "name": "Carlos López",
                "email": "...",
                "specialty": "Electricista",
                "department": "Mantenimiento"
            },
            "workload": {
                "current": 6,
                "max": 20,
                "percentage": 30,
                "status": "available"
            },
            "incidents": {
                "active": 2,
                "pending": 1,
                "inProgress": 1,
                "resolved": 0,
                "totalAssigned": 47,
                "totalResolved": 45
            },
            "performance": {
                "avgResolutionTimeHours": 2.5,
                "rating": 4.5,
                "completionRate": 95.74
            },
            "recentIncidents": [...],
            "incidentsByCategory": {
                "electricidad": 25,
                "plomeria": 12,
                "otros": 8
            },
            "incidentsByPriority": {
                "urgent": 5,
                "high": 15,
                "medium": 20,
                "low": 5
            }
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
            return not_found("ID de trabajador no proporcionado")
        
        # Verificar permisos: admin o el mismo worker
        if not is_admin(user) and user['userId'] != worker_id:
            return forbidden("No tienes permiso para ver estas estadísticas")
        
        # Obtener datos del trabajador
        worker = get_user_by_id(worker_id)
        
        if not worker:
            return not_found(f"Trabajador {worker_id} no encontrado")
        
        # Validar que sea un trabajador
        if worker.get('role') != 'worker':
            return not_found("El usuario especificado no es un trabajador")
        
        # Obtener todos los incidentes del trabajador (activos + históricos)
        all_incidents_result = get_incidents_by_worker(worker_id, limit=1000)
        all_incidents = all_incidents_result.get('items', [])
        
        # Calcular estadísticas
        stats = _calculate_worker_stats(worker, all_incidents)
        
        # Convertir Decimals
        stats = decimal_to_float(stats)
        
        return success_response(
            message="Estadísticas obtenidas exitosamente",
            data=stats
        )
    
    except Exception as e:
        print(f"Error en worker stats: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al obtener estadísticas: {str(e)}")


def _calculate_worker_stats(worker: Dict, incidents: List[Dict]) -> Dict[str, Any]:
    """Calcula estadísticas completas de un trabajador"""
    
    # Información básica del trabajador
    worker_info = {
        'userId': worker['userId'],
        'name': worker.get('name'),
        'email': worker.get('email'),
        'phone': worker.get('phone'),
        'specialty': worker.get('specialty', 'General'),
        'department': worker.get('department', 'Mantenimiento')
    }
    
    # Estadísticas de carga de trabajo
    current_workload = worker.get('workloadPoints', 0)
    max_workload = worker.get('maxWorkloadPoints', 20)
    
    workload_stats = {
        'current': current_workload,
        'max': max_workload,
        'percentage': round((current_workload / max_workload) * 100, 2) if max_workload > 0 else 0,
        'status': get_worker_status(current_workload)
    }
    
    # Separar incidentes por estado
    active_incidents = [inc for inc in incidents if inc.get('status') not in ['resolved', 'closed']]
    pending_incidents = [inc for inc in active_incidents if inc.get('status') == 'pending']
    in_progress_incidents = [inc for inc in active_incidents if inc.get('status') == 'in_progress']
    assigned_incidents = [inc for inc in active_incidents if inc.get('status') == 'assigned']
    resolved_incidents = [inc for inc in incidents if inc.get('status') == 'resolved']
    closed_incidents = [inc for inc in incidents if inc.get('status') == 'closed']
    
    # Estadísticas de incidentes
    incident_stats = {
        'active': len(active_incidents),
        'pending': len(pending_incidents),
        'assigned': len(assigned_incidents),
        'inProgress': len(in_progress_incidents),
        'resolved': len(resolved_incidents),
        'closed': len(closed_incidents),
        'totalAssigned': len(incidents),
        'totalResolved': len(resolved_incidents) + len(closed_incidents)
    }
    
    # Calcular tiempo promedio de resolución
    resolution_times = []
    for inc in resolved_incidents + closed_incidents:
        if inc.get('resolvedAt') and inc.get('createdAt'):
            resolution_time_ms = inc['resolvedAt'] - inc['createdAt']
            resolution_time_hours = resolution_time_ms / (1000 * 60 * 60)
            resolution_times.append(resolution_time_hours)
    
    avg_resolution_time = round(sum(resolution_times) / len(resolution_times), 2) if resolution_times else 0
    
    # Calcular tasa de completación
    total_assigned = len(incidents)
    total_completed = len(resolved_incidents) + len(closed_incidents)
    completion_rate = round((total_completed / total_assigned) * 100, 2) if total_assigned > 0 else 0
    
    # Estadísticas de desempeño
    performance_stats = {
        'avgResolutionTimeHours': avg_resolution_time,
        'rating': round(worker.get('rating', 0.0), 1),
        'completionRate': completion_rate,
        'totalIncidentsHandled': total_assigned
    }
    
    # Incidentes recientes (últimos 10 activos)
    recent_incidents = sorted(
        active_incidents,
        key=lambda x: x.get('updatedAt', x.get('createdAt', 0)),
        reverse=True
    )[:10]
    
    recent_incidents_data = [
        {
            'incidentId': inc['incidentId'],
            'title': inc['title'],
            'priority': inc['priority'],
            'status': inc['status'],
            'category': inc['category'],
            'location': inc.get('location', {}),
            'createdAt': inc.get('createdAt'),
            'updatedAt': inc.get('updatedAt')
        }
        for inc in recent_incidents
    ]
    
    # Incidentes por categoría
    incidents_by_category = {}
    for inc in incidents:
        category = inc.get('category', 'otros')
        incidents_by_category[category] = incidents_by_category.get(category, 0) + 1
    
    # Incidentes por prioridad
    incidents_by_priority = {}
    for inc in incidents:
        priority = inc.get('priority', 'medium')
        incidents_by_priority[priority] = incidents_by_priority.get(priority, 0) + 1
    
    # Distribución de tiempo de resolución
    resolution_distribution = {
        'lessThan1Hour': len([t for t in resolution_times if t < 1]),
        'between1And3Hours': len([t for t in resolution_times if 1 <= t < 3]),
        'between3And6Hours': len([t for t in resolution_times if 3 <= t < 6]),
        'between6And24Hours': len([t for t in resolution_times if 6 <= t < 24]),
        'moreThan24Hours': len([t for t in resolution_times if t >= 24])
    }
    
    # Construir respuesta completa
    return {
        'worker': worker_info,
        'workload': workload_stats,
        'incidents': incident_stats,
        'performance': performance_stats,
        'recentIncidents': recent_incidents_data,
        'incidentsByCategory': incidents_by_category,
        'incidentsByPriority': incidents_by_priority,
        'resolutionTimeDistribution': resolution_distribution
    }