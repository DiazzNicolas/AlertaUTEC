"""
Validadores y esquemas de datos usando Pydantic
"""
from typing import Optional, List, Dict
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


# ==========================================
# VALIDADORES DE USUARIOS
# ==========================================

class RegisterUserSchema(BaseModel):
    """Esquema para registrar un nuevo usuario"""
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
    name: str = Field(min_length=2, max_length=100)
    role: str = Field(pattern=r'^(alumno|worker|admin)$')
    phone: Optional[str] = Field(None, pattern=r'^\+51\d{9}$')
    
    # Campos específicos para alumnos
    studentCode: Optional[str] = Field(None, min_length=8, max_length=15)
    faculty: Optional[str] = None
    career: Optional[str] = None
    
    # Campos específicos para workers
    specialty: Optional[str] = None
    department: Optional[str] = None
    
    @field_validator('email')
    @classmethod
    def validate_university_email(cls, v):
        if not v.endswith('@universidad.edu.pe'):
            raise ValueError('Debe usar un correo institucional (@universidad.edu.pe)')
        return v.lower()
    
    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v):
        if not re.search(r'[A-Z]', v):
            raise ValueError('La contraseña debe contener al menos una mayúscula')
        if not re.search(r'[a-z]', v):
            raise ValueError('La contraseña debe contener al menos una minúscula')
        if not re.search(r'\d', v):
            raise ValueError('La contraseña debe contener al menos un número')
        return v
    
    @field_validator('role')
    @classmethod
    def validate_role_fields(cls, v, info):
        """Valida que los campos requeridos según el rol estén presentes"""
        if v == 'alumno':
            if not info.data.get('studentCode'):
                raise ValueError('El código de estudiante es requerido para alumnos')
        elif v == 'worker':
            if not info.data.get('specialty'):
                raise ValueError('La especialidad es requerida para trabajadores')
        return v


class LoginSchema(BaseModel):
    """Esquema para login"""
    email: EmailStr
    password: str


# ==========================================
# VALIDADORES DE INCIDENTES
# ==========================================

class LocationSchema(BaseModel):
    """Esquema para ubicación del incidente"""
    building: str = Field(min_length=1, max_length=100)
    floor: int = Field(ge=0, le=20)
    room: str = Field(min_length=1, max_length=50)
    specificLocation: Optional[str] = None


class CreateIncidentSchema(BaseModel):
    """Esquema para crear un incidente"""
    title: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=10, max_length=2000)
    category: str = Field(
        pattern=r'^(mantenimiento-general|seguridad|infraestructura|limpieza|electricidad|plomeria|sistemas-tecnologia|elevadores|otros)$'
    )
    priority: str = Field(pattern=r'^(low|medium|high|urgent)$')
    location: LocationSchema
    images: Optional[List[str]] = Field(None, max_length=5)  # Máximo 5 imágenes
    
    @field_validator('images')
    @classmethod
    def validate_images(cls, v):
        if v is None:
            return v
        if len(v) > 5:
            raise ValueError('Máximo 5 imágenes permitidas')
        return v


class UpdateIncidentSchema(BaseModel):
    """Esquema para actualizar un incidente"""
    status: Optional[str] = Field(
        None,
        pattern=r'^(pending|assigned|in_progress|resolved|closed)$'
    )
    comment: Optional[str] = Field(None, max_length=1000)
    priority: Optional[str] = Field(
        None,
        pattern=r'^(low|medium|high|urgent)$'
    )


class AssignIncidentSchema(BaseModel):
    """Esquema para asignar un trabajador"""
    workerId: str = Field(min_length=1)


# ==========================================
# VALIDADORES DE QUERIES
# ==========================================

class IncidentQueryParams(BaseModel):
    """Parámetros de búsqueda para incidentes"""
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    assignedTo: Optional[str] = None
    building: Optional[str] = None
    limit: Optional[int] = Field(50, ge=1, le=100)
    lastKey: Optional[str] = None


class WorkerQueryParams(BaseModel):
    """Parámetros de búsqueda para trabajadores"""
    status: Optional[str] = Field(None, pattern=r'^(available|moderate|busy)$')
    specialty: Optional[str] = None
    sortBy: Optional[str] = Field('workload', pattern=r'^(workload|name|activeIncidents)$')
    order: Optional[str] = Field('asc', pattern=r'^(asc|desc)$')
    limit: Optional[int] = Field(50, ge=1, le=100)


# ==========================================
# FUNCIONES DE VALIDACIÓN
# ==========================================

def validate_incident_status_transition(current_status: str, new_status: str) -> bool:
    """
    Valida que la transición de estado sea válida
    
    Estados permitidos: pending -> assigned -> in_progress -> resolved -> closed
    """
    valid_transitions = {
        'pending': ['assigned'],
        'assigned': ['in_progress', 'pending'],
        'in_progress': ['resolved', 'assigned'],
        'resolved': ['closed', 'in_progress'],
        'closed': []  # No se puede cambiar desde cerrado
    }
    
    allowed = valid_transitions.get(current_status, [])
    return new_status in allowed


def validate_priority_points(priority: str) -> int:
    """
    Retorna los puntos de carga según la prioridad
    """
    priority_points = {
        'low': 1,
        'medium': 2,
        'high': 4,
        'urgent': 10
    }
    return priority_points.get(priority, 2)


def validate_worker_capacity(
    current_workload: int,
    incident_priority: str,
    max_workload: int = 20
) -> bool:
    """
    Valida si el trabajador puede tomar otro incidente
    
    Args:
        current_workload: Carga actual del trabajador
        incident_priority: Prioridad del nuevo incidente
        max_workload: Carga máxima permitida
    
    Returns:
        True si puede tomar el incidente
    """
    new_points = validate_priority_points(incident_priority)
    return (current_workload + new_points) <= max_workload


def validate_email_format(email: str) -> bool:
    """Valida formato de email"""
    pattern = r'^[a-zA-Z0-9._%+-]+@universidad\.edu\.pe$'
    return bool(re.match(pattern, email))


def validate_phone_format(phone: str) -> bool:
    """Valida formato de teléfono peruano"""
    pattern = r'^\+51\d{9}$'
    return bool(re.match(pattern, phone))


def validate_student_code(code: str) -> bool:
    """Valida formato de código de estudiante"""
    # Formato: año (4 dígitos) + código (6 dígitos) = 10 dígitos
    pattern = r'^\d{10}$'
    return bool(re.match(pattern, code))


def sanitize_string(text: str) -> str:
    """
    Sanitiza un string eliminando caracteres peligrosos
    
    Args:
        text: Texto a sanitizar
    
    Returns:
        Texto sanitizado
    """
    # Remover caracteres de control
    text = ''.join(char for char in text if ord(char) >= 32 or char == '\n')
    # Limitar longitud
    text = text[:2000]
    return text.strip()


def get_worker_status(workload_points: int) -> str:
    """
    Determina el estado del trabajador según su carga
    
    Args:
        workload_points: Puntos de carga actual
    
    Returns:
        Estado: available, moderate o busy
    """
    if workload_points <= 10:
        return 'available'
    elif workload_points <= 15:
        return 'moderate'
    else:
        return 'busy'