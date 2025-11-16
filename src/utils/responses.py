"""
Utilidades para generar respuestas HTTP estandarizadas
"""
import json
from typing import Any, Dict, Optional


def success_response(
    message: str,
    data: Optional[Any] = None,
    status_code: int = 200
) -> Dict[str, Any]:
    """
    Genera una respuesta exitosa estandarizada
    
    Args:
        message: Mensaje descriptivo del éxito
        data: Datos a retornar (opcional)
        status_code: Código HTTP (default: 200)
    
    Returns:
        Dict con statusCode, headers y body
    """
    body = {
        "success": True,
        "message": message
    }
    
    if data is not None:
        body["data"] = data
    
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": True,
        },
        "body": json.dumps(body, ensure_ascii=False, default=str)
    }


def error_response(
    message: str,
    status_code: int = 400,
    error_type: Optional[str] = None,
    details: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Genera una respuesta de error estandarizada
    
    Args:
        message: Mensaje descriptivo del error
        status_code: Código HTTP de error
        error_type: Tipo de error (opcional)
        details: Detalles adicionales del error (opcional)
    
    Returns:
        Dict con statusCode, headers y body
    """
    body = {
        "success": False,
        "message": message
    }
    
    if error_type:
        body["error"] = error_type
    
    if details:
        body["details"] = details
    
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": True,
        },
        "body": json.dumps(body, ensure_ascii=False, default=str)
    }


def bad_request(message: str = "Solicitud inválida", details: Optional[Dict] = None) -> Dict[str, Any]:
    """Respuesta 400 - Bad Request"""
    return error_response(message, 400, "BAD_REQUEST", details)


def unauthorized(message: str = "No autorizado") -> Dict[str, Any]:
    """Respuesta 401 - Unauthorized"""
    return error_response(message, 401, "UNAUTHORIZED")


def forbidden(message: str = "Acceso denegado") -> Dict[str, Any]:
    """Respuesta 403 - Forbidden"""
    return error_response(message, 403, "FORBIDDEN")


def not_found(message: str = "Recurso no encontrado") -> Dict[str, Any]:
    """Respuesta 404 - Not Found"""
    return error_response(message, 404, "NOT_FOUND")


def conflict(message: str = "Conflicto con el estado actual", details: Optional[Dict] = None) -> Dict[str, Any]:
    """Respuesta 409 - Conflict"""
    return error_response(message, 409, "CONFLICT", details)


def internal_error(message: str = "Error interno del servidor") -> Dict[str, Any]:
    """Respuesta 500 - Internal Server Error"""
    return error_response(message, 500, "INTERNAL_ERROR")


def created(message: str, data: Optional[Any] = None) -> Dict[str, Any]:
    """Respuesta 201 - Created"""
    return success_response(message, data, 201)


def no_content() -> Dict[str, Any]:
    """Respuesta 204 - No Content"""
    return {
        "statusCode": 204,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": True,
        },
        "body": ""
    }