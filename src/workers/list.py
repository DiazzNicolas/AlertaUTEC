"""
Lambda function: Listar personal de mantenimiento
Endpoint: GET /workers
Requiere: Autenticación (solo admin)
"""
import json
import os
from typing import Dict, Any, List

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, bad_request, unauthorized, forbidden, internal_error
from utils.dynamodb import (
    get_workers, get_incidents_by_worker, decimal_to_float
)
from utils.validators import get_worker_status
from utils.auth import require_auth, is_admin


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lista personal de mantenimiento con su carga de trabajo
    
    Query Parameters:
    - status: available, moderate, busy (filtrar por disponibilidad)
    - specialty: Electricista, Plomero, etc.
    - sortBy: workload, name, activeIncidents (default: workload)
    - order: asc, desc (default: asc)
    - limit: número de resultados (default: 50, max: 100)
    
    Examples:
    GET /workers
    GET /workers?status=available&sortBy=workload&order=asc
    GET /workers?specialty=Electricista
    GET /workers?sortBy=activeIncidents&order=desc
    
    Response:
    {
        "success": true,
        "data": {
            "workers": [
                {
                    "userId": "usr_worker123",
                    "name": "Carlos López",
                    "email": "carlos.lopez@universidad.edu.pe",
                    "phone": "+51999555666",
                    "specialty": "Electricista",
                    "department": "Mantenimiento",
                    "activeIncidents": 2,
                    "workloadPoints": 6,
                    "maxWorkloadPoints": 20,
                    "status": "available",
                    "currentIncidents": [...],
                    "stats": {
                        "totalResolved": 45,
                        "avgResolutionTimeHours": 2.5,
                        "rating": 4.5
                    }
                }
            ],
            "count": 3,
            "sortedBy": "workload",
            "order": "asc"
        }
    }
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Solo administradores pueden ver la lista de trabajadores
        if not is_admin(user):
            return forbidden("Solo los administradores pueden ver la lista de trabajadores")
        
        # Obtener query parameters
        params = event.get('queryStringParameters') or {}
        
        status_filter = params.get('status')
        specialty_filter = params.get('specialty')
        sort_by = params.get('sortBy', 'workload')
        order = params.get('order', 'asc')
        limit = int(params.get('limit', 50))
        
        # Validar parámetros
        if limit > 100:
            limit = 100
        
        if sort_by not in ['workload', 'name', 'activeIncidents']:
            return bad_request(
                "sortBy inválido. Use: workload, name, activeIncidents",
                details={'sortBy': sort_by}
            )
        
        if order not in ['asc', 'desc']:
            return bad_request(
                "order inválido. Use: asc, desc",
                details={'order': order}
            )
        
        if status_filter and status_filter not in ['available', 'moderate', 'busy']:
            return bad_request(
                "status inválido. Use: available, moderate, busy",
                details={'status': status_filter}
            )
        
        # Obtener todos los workers
        workers = get_workers()
        
        if not workers:
            return success_response(
                message="No hay trabajadores registrados",
                data={
                    'workers': [],
                    'count': 0,
                    'sortedBy': sort_by,
                    'order': order
                }
            )
        
        # Enriquecer workers con incidentes actuales
        enriched_workers = []
        for worker in workers:
            # Calcular status actual basado en workloadPoints
            current_workload = worker.get('workloadPoints', 0)
            worker_status = get_worker_status(current_workload)
            
            # Aplicar filtro de status
            if status_filter and worker_status != status_filter:
                continue
            
            # Aplicar filtro de specialty
            if specialty_filter and worker.get('specialty') != specialty_filter:
                continue
            
            # Obtener incidentes actuales del worker
            current_incidents = []
            try:
                incidents_result = get_incidents_by_worker(worker['userId'], limit=20)
                incidents = incidents_result.get('items', [])
                
                # Filtrar solo incidentes activos (no resueltos ni cerrados)
                active_incidents = [
                    inc for inc in incidents 
                    if inc.get('status') not in ['resolved', 'closed']
                ]
                
                # Preparar datos resumidos de incidentes
                current_incidents = [
                    {
                        'incidentId': inc['incidentId'],
                        'title': inc['title'],
                        'priority': inc['priority'],
                        'status': inc['status'],
                        'category': inc['category'],
                        'location': inc.get('location', {}).get('building'),
                        'assignedAt': inc.get('updatedAt', inc.get('createdAt'))
                    }
                    for inc in active_incidents
                ]
            except Exception as e:
                print(f"Error obteniendo incidentes para worker {worker['userId']}: {str(e)}")
            
            # Construir objeto de worker enriquecido
            enriched_worker = {
                'userId': worker['userId'],
                'name': worker.get('name'),
                'email': worker.get('email'),
                'phone': worker.get('phone'),
                'specialty': worker.get('specialty', 'General'),
                'department': worker.get('department', 'Mantenimiento'),
                'activeIncidents': len(current_incidents),
                'workloadPoints': current_workload,
                'maxWorkloadPoints': worker.get('maxWorkloadPoints', 20),
                'status': worker_status,
                'currentIncidents': current_incidents,
                'stats': {
                    'totalResolved': worker.get('totalResolved', 0),
                    'avgResolutionTimeHours': round(worker.get('avgResolutionTimeHours', 0.0), 2),
                    'rating': round(worker.get('rating', 0.0), 1)
                }
            }
            
            enriched_workers.append(enriched_worker)
        
        # Ordenar workers
        enriched_workers = _sort_workers(enriched_workers, sort_by, order)
        
        # Aplicar límite
        enriched_workers = enriched_workers[:limit]
        
        # Convertir Decimals
        enriched_workers = decimal_to_float(enriched_workers)
        
        # Preparar respuesta
        response_data = {
            'workers': enriched_workers,
            'count': len(enriched_workers),
            'sortedBy': sort_by,
            'order': order
        }
        
        if status_filter:
            response_data['filteredBy'] = {'status': status_filter}
        if specialty_filter:
            if 'filteredBy' not in response_data:
                response_data['filteredBy'] = {}
            response_data['filteredBy']['specialty'] = specialty_filter
        
        return success_response(
            message=f"{len(enriched_workers)} trabajador(es) encontrado(s)",
            data=response_data
        )
    
    except Exception as e:
        print(f"Error en list workers: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al listar trabajadores: {str(e)}")


def _sort_workers(workers: List[Dict], sort_by: str, order: str) -> List[Dict]:
    """Ordena la lista de trabajadores según el criterio especificado"""
    
    reverse = (order == 'desc')
    
    if sort_by == 'workload':
        return sorted(workers, key=lambda w: w.get('workloadPoints', 0), reverse=reverse)
    
    elif sort_by == 'name':
        return sorted(workers, key=lambda w: w.get('name', '').lower(), reverse=reverse)
    
    elif sort_by == 'activeIncidents':
        return sorted(workers, key=lambda w: w.get('activeIncidents', 0), reverse=reverse)
    
    return workers