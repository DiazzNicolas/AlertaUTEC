"""
Utilidades de autenticación y autorización
"""
import os
import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any


# JWT Secret desde variable de entorno
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24


def hash_password(password: str) -> str:
    """
    Hashea una contraseña usando bcrypt
    
    Args:
        password: Contraseña en texto plano
    
    Returns:
        Hash de la contraseña
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(password: str, hashed_password: str) -> bool:
    """
    Verifica si una contraseña coincide con su hash
    
    Args:
        password: Contraseña en texto plano
        hashed_password: Hash almacenado
    
    Returns:
        True si coinciden
    """
    try:
        return bcrypt.checkpw(
            password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception as e:
        print(f"Error verificando contraseña: {str(e)}")
        return False


def generate_token(user_data: Dict[str, Any]) -> str:
    """
    Genera un JWT token para un usuario
    
    Args:
        user_data: Datos del usuario (userId, email, role, name)
    
    Returns:
        JWT token como string
    """
    payload = {
        'userId': user_data.get('userId'),
        'email': user_data.get('email'),
        'role': user_data.get('role'),
        'name': user_data.get('name'),
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodifica y valida un JWT token
    
    Args:
        token: JWT token
    
    Returns:
        Payload del token o None si es inválido
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        print("Token expirado")
        return None
    except jwt.InvalidTokenError as e:
        print(f"Token inválido: {str(e)}")
        return None


def extract_token_from_header(authorization_header: Optional[str]) -> Optional[str]:
    """
    Extrae el token del header Authorization
    
    Args:
        authorization_header: Header "Authorization: Bearer <token>"
    
    Returns:
        Token o None
    """
    if not authorization_header:
        return None
    
    parts = authorization_header.split()
    
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        return None
    
    return parts[1]


def get_user_from_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extrae los datos del usuario autenticado desde el evento Lambda
    
    Args:
        event: Evento de Lambda
    
    Returns:
        Datos del usuario o None
    """
    headers = event.get('headers', {})
    
    # Buscar el header Authorization (case-insensitive)
    auth_header = None
    for key, value in headers.items():
        if key.lower() == 'authorization':
            auth_header = value
            break
    
    if not auth_header:
        return None
    
    token = extract_token_from_header(auth_header)
    if not token:
        return None
    
    return decode_token(token)


def require_auth(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Valida que el request tenga un token válido
    Lanza excepción si no está autenticado
    
    Args:
        event: Evento de Lambda
    
    Returns:
        Datos del usuario
    
    Raises:
        ValueError: Si no está autenticado
    """
    user = get_user_from_event(event)
    
    if not user:
        raise ValueError("No autorizado - Token inválido o ausente")
    
    return user


def require_role(event: Dict[str, Any], allowed_roles: list) -> Dict[str, Any]:
    """
    Valida que el usuario tenga uno de los roles permitidos
    
    Args:
        event: Evento de Lambda
        allowed_roles: Lista de roles permitidos
    
    Returns:
        Datos del usuario
    
    Raises:
        ValueError: Si no tiene permisos
    """
    user = require_auth(event)
    
    if user['role'] not in allowed_roles:
        raise ValueError(f"Acceso denegado - Requiere rol: {', '.join(allowed_roles)}")
    
    return user


def is_admin(user: Dict[str, Any]) -> bool:
    """Verifica si el usuario es administrador"""
    return user.get('role') == 'admin'


def is_worker(user: Dict[str, Any]) -> bool:
    """Verifica si el usuario es trabajador"""
    return user.get('role') == 'worker'


def is_student(user: Dict[str, Any]) -> bool:
    """Verifica si el usuario es alumno"""
    return user.get('role') == 'alumno'


def can_update_incident(user: Dict[str, Any], incident: Dict[str, Any]) -> bool:
    """
    Verifica si el usuario puede actualizar un incidente
    
    Args:
        user: Datos del usuario
        incident: Datos del incidente
    
    Returns:
        True si puede actualizar
    """
    # Admin puede actualizar cualquier incidente
    if is_admin(user):
        return True
    
    # Worker puede actualizar incidentes asignados a él
    if is_worker(user):
        return incident.get('assignedTo') == user.get('userId')
    
    # Alumno solo puede comentar en sus propios incidentes
    if is_student(user):
        return incident.get('reportedBy') == user.get('userId')
    
    return False


def can_assign_incident(user: Dict[str, Any]) -> bool:
    """
    Verifica si el usuario puede asignar incidentes
    Solo administradores pueden asignar
    
    Args:
        user: Datos del usuario
    
    Returns:
        True si puede asignar
    """
    return is_admin(user)


def generate_password_reset_token(user_id: str) -> str:
    """
    Genera un token para resetear contraseña
    
    Args:
        user_id: ID del usuario
    
    Returns:
        Token de reseteo
    """
    payload = {
        'userId': user_id,
        'type': 'password_reset',
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=1)  # Expira en 1 hora
    }
    
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def verify_password_reset_token(token: str) -> Optional[str]:
    """
    Verifica un token de reseteo de contraseña
    
    Args:
        token: Token de reseteo
    
    Returns:
        userId si es válido, None si no
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        if payload.get('type') != 'password_reset':
            return None
        
        return payload.get('userId')
    except:
        return None