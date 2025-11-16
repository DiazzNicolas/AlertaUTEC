"""
Lambda function: Crear nuevo incidente
Endpoint: POST /incidents
Requiere: Autenticación (todos los roles pueden crear incidentes)
"""
import json
import os
import time
import uuid
from typing import Dict, Any

# Importar utilidades
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from websocket.broadcast import *
from utils.responses import created, bad_request, unauthorized, internal_error
from utils.dynamodb import put_item, get_user_by_id, INCIDENTS_TABLE
from utils.validators import CreateIncidentSchema, sanitize_string
from utils.auth import require_auth
from utils.s3_helper import upload_multiple_images
from pydantic import ValidationError


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Crea un nuevo incidente en el sistema
    
    Request Body:
    {
        "title": "Luz fundida en Aula 302",
        "description": "La luz fluorescente está fundida...",
        "category": "electricidad",
        "priority": "medium",
        "location": {
            "building": "Pabellón A",
            "floor": 3,
            "room": "302",
            "specificLocation": "Aula de clases"
        },
        "images": ["data:image/jpeg;base64,...", ...]
    }
    
    Response:
    {
        "success": true,
        "message": "Incidente creado exitosamente",
        "data": {
            "incidentId": "inc_xyz789",
            "title": "...",
            "status": "pending",
            "createdAt": 1700000000000,
            "imageUrls": ["https://..."]
        }
    }
    """
    try:
        # Verificar autenticación
        try:
            user = require_auth(event)
        except ValueError as e:
            return unauthorized(str(e))
        
        # Parsear body
        body = json.loads(event.get('body', '{}'))
        
        # Validar datos con Pydantic
        try:
            incident_data = CreateIncidentSchema(**body)
        except ValidationError as e:
            errors = {}
            for error in e.errors():
                field = '.'.join(str(loc) for loc in error['loc'])
                errors[field] = error['msg']
            return bad_request(
                message="Datos del incidente inválidos",
                details=errors
            )
        
        # Generar ID único
        incident_id = f"inc_{uuid.uuid4().hex[:12]}"
        current_timestamp = int(time.time() * 1000)
        
        # Construir objeto de incidente
        incident_item = {
            'incidentId': incident_id,
            'title': sanitize_string(incident_data.title),
            'description': sanitize_string(incident_data.description),
            'category': incident_data.category,
            'priority': incident_data.priority,
            'status': 'pending',
            'location': {
                'building': sanitize_string(incident_data.location.building),
                'floor': incident_data.location.floor,
                'room': sanitize_string(incident_data.location.room),
                'specificLocation': sanitize_string(incident_data.location.specificLocation) 
                    if incident_data.location.specificLocation else None
            },
            'images': [],
            'reportedBy': user['userId'],
            'assignedTo': None,
            'createdAt': current_timestamp,
            'updatedAt': current_timestamp,
            'resolvedAt': None,
            'comments': []
        }
        
        # Subir imágenes a S3 si existen
        image_urls = []
        if incident_data.images and len(incident_data.images) > 0:
            try:
                uploaded_images = upload_multiple_images(
                    incident_data.images,
                    incident_id
                )
                
                # Guardar las keys de S3 en el incidente
                incident_item['images'] = [s3_key for s3_key, _ in uploaded_images]
                
                # Guardar las URLs públicas para la respuesta
                image_urls = [url for _, url in uploaded_images]
                
            except Exception as e:
                print(f"Error subiendo imágenes: {str(e)}")
                # Continuar sin imágenes en caso de error
                incident_item['images'] = []
        
        # Guardar incidente en DynamoDB
        put_item(INCIDENTS_TABLE, incident_item)
        
        # Obtener datos del usuario que reporta
        reporter = get_user_by_id(user['userId'])
        reporter_info = {
            'userId': user['userId'],
            'name': reporter.get('name', 'Usuario') if reporter else 'Usuario',
            'email': reporter.get('email', '') if reporter else ''
        }
        
        # TODO: Enviar notificación WebSocket a administradores
        broadcast_new_incident(incident_item, reporter_info)
        
        # TODO: Enviar notificación SNS
        # send_sns_notification(incident_item)
        
        # Preparar respuesta
        response_data = {
            'incidentId': incident_id,
            'title': incident_item['title'],
            'description': incident_item['description'],
            'category': incident_item['category'],
            'priority': incident_item['priority'],
            'status': incident_item['status'],
            'location': incident_item['location'],
            'reportedBy': reporter_info,
            'createdAt': current_timestamp,
            'imageUrls': image_urls
        }
        
        return created(
            message="Incidente creado exitosamente",
            data=response_data
        )
    
    except json.JSONDecodeError:
        return bad_request("Formato JSON inválido")
    
    except Exception as e:
        print(f"Error en create incident: {str(e)}")
        import traceback
        traceback.print_exc()
        return internal_error(f"Error al crear incidente: {str(e)}")