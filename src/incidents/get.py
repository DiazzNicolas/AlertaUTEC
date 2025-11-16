"""
Lambda function: Obtener detalle de un incidente
Endpoint: GET /incidents/{id}
Requiere: Autenticación
"""
import json
import os
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from utils.responses import success_response, unauthorized, not_found, forbidden, internal_error
from utils.dynamodb import get_incident_by_id, get_user_by_id, decimal_to_float
from utils.auth import require_auth, is_student
from utils.s3_helper import get_image_url


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Obtiene el detalle completo de un incidente
    
    Path Parameters:
    - id: incidentId
    
    Response:
    {
        "success": true,
        "data": {
            "incidentId": "inc_xyz789",
            "title": "...",
            "description": "...",
            "category": "electricidad",
            "priority": "medium",
            "status": "assigned",
            "location": {...},
            "images": ["https://..."],
            "reportedBy": {
                "userId": "...",
                "name": "...",
                "email": "...",
                "studentCode": "..."
            },
            "assignedTo": {
                "userId": "...",
                "name": "...",
                "specialty": "..."
            },
            "createdAt": 1700000000000,
            "updatedAt": 1700000000000,
            "comments": [...]
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
            return not_found("ID de incidente no proporcionado")
        
        # Obtener incidente
        incident = get_incident_by_id(incident_id)
        
        if not incident:
            return not_found(f"Incidente {incident_id} no encontrado")
        
        # Verificar permisos
        # Estudiantes solo pueden ver sus propios incidentes
        if is_student(user) and incident.get('reportedBy') != user['userId']:
            return forbidden("No tienes permiso para ver este incidente")
        
        # Obtener información del reportador
        reported_by_id = incident.get('reportedBy')
        reporter_info = None
        if reported_by_id:
            reporter = get_user_by_id(reported_by_id)
            if reporter:
                reporter_info = {
                    'userId': reporter['userId'],
                    'name': reporter.get('name'),
                    'email': reporter.get('email'),
                    'phone': reporter.get('phone')
                }
                if reporter.get('studentCode'):
                    reporter_info['studentCode'] = reporter['studentCode']
                if reporter.get('faculty'):
                    reporter_info['faculty'] = reporter['faculty']
        
        # Obtener información del trabajador asignado
        assigned_to_id = incident.get('assignedTo')
        worker_info = None
        if assigned_to_id:
            worker = get_user_by_id(assigned_to_id)
            if worker:
                worker_info = {
                    'userId': worker['userId'],
                    'name': worker.get('name'),
                    'email': worker.get('email'),
                    'phone': worker.get('phone'),
                    'specialty': worker.get('specialty'),
                    'department': worker.get('department'),
                    'workloadPoints': worker.get('workloadPoints', 0)
                }
        
        # Generar URLs pre-firmadas para las imágenes
        image_urls = []
        if incident.get('images'):
            for s3_key in incident['images']:
                try:
                    url = get_image_url(s3_key, expires_in=3600)  # 1 hora
                    image_urls.append(url)
                except Exception as e:
                    print(f"Error generando URL para {s3_key}: {str(e)}")
        
        # Enriquecer comentarios con info de usuarios
        comments = incident.get('comments', [])
        enriched_comments = []
        for comment in comments:
            enriched_comment = comment.copy()
            
            # Si el comentario tiene userId, obtener info del usuario
            comment_user_id = comment.get('userId')
            if comment_user_id:
                comment_user = get_user_by_id(comment_user_id)
                if comment_user:
                    enriched_comment['userName'] = comment_user.get('name', 'Usuario')
                    enriched_comment['userRole'] = comment_user.get('role')
            
            enriched_comments.append(enriched_comment)
        
        # Construir respuesta
        incident_detail = {
            'incidentId': incident['incidentId'],
            'title': incident['title'],
            'description': incident['description'],
            'category': incident['category'],
            'priority': incident['priority'],
            'status': incident['status'],
            'location': incident['location'],
            'images': image_urls,
            'reportedBy': reporter_info,
            'assignedTo': worker_info,
            'createdAt': incident['createdAt'],
            'updatedAt': incident['updatedAt'],
            'resolvedAt': incident.get('resolvedAt'),
            'comments': enriched_comments
        }
        
        # Convertir Decimals a float/int
        incident_detail = decimal_to_float(incident_detail)
        
        return success_response(
            message="Incidente obtenido exitosamente",
            data=incident_detail
        )
    
    except Exception as e:
        print(f"Error en get incident: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al obtener incidente: {str(e)}")