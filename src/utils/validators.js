/**
 * Validadores y esquemas de datos
 */

// ==========================================
// VALIDADORES DE USUARIOS
// ==========================================

/**
 * Valida los datos de registro de usuario
 * @param {Object} data - Datos del usuario
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateRegisterUser(data) {
  const errors = [];
  
  if (!data) {
    errors.push('Datos de registro requeridos');
    return { valid: false, errors };
  }

  const { email, password, name, role, phone, studentCode, specialty } = data;

  // Email
  if (!email) {
    errors.push('Email es requerido');
  } else if (!validateEmailFormat(email)) {
    errors.push('Email inválido. Debe ser un correo institucional válido');
  }

  // Password
  if (!password) {
    errors.push('Password es requerido');
  } else if (password.length < 8) {
    errors.push('Password debe tener mínimo 8 caracteres');
  } else if (password.length > 100) {
    errors.push('Password debe tener máximo 100 caracteres');
  } else if (!validatePasswordStrength(password)) {
    errors.push('Password debe contener al menos una mayúscula, una minúscula y un número');
  }

  // Name
  if (!name) {
    errors.push('Nombre es requerido');
  } else if (name.trim().length < 2) {
    errors.push('Nombre debe tener al menos 2 caracteres');
  } else if (name.length > 100) {
    errors.push('Nombre debe tener máximo 100 caracteres');
  }

  // Role
  const validRoles = ['alumno', 'worker', 'admin'];
  if (!role) {
    errors.push('Rol es requerido');
  } else if (!validRoles.includes(role)) {
    errors.push('Rol inválido. Debe ser: alumno, worker o admin');
  }

  // Phone (opcional, pero si existe debe ser válido)
  if (phone && !validatePhoneFormat(phone)) {
    errors.push('Formato de teléfono inválido. Debe ser +51XXXXXXXXX');
  }

  // Validaciones específicas por rol
  if (role === 'alumno' && !studentCode) {
    errors.push('El código de estudiante es requerido para alumnos');
  }

  if (role === 'worker' && !specialty) {
    errors.push('La especialidad es requerida para trabajadores');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida los datos de login
 * @param {Object} data - Datos de login
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateLogin(data) {
  const errors = [];
  
  if (!data) {
    errors.push('Datos de login requeridos');
    return { valid: false, errors };
  }

  const { email, password } = data;

  if (!email) {
    errors.push('Email es requerido');
  }

  if (!password) {
    errors.push('Password es requerido');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ==========================================
// VALIDADORES DE INCIDENTES
// ==========================================

/**
 * Valida los datos para crear un incidente
 * @param {Object} data - Datos del incidente
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateCreateIncident(data) {
  const errors = [];
  
  if (!data) {
    errors.push('Datos del incidente requeridos');
    return { valid: false, errors };
  }

  const { title, description, category, priority, location, images } = data;

  // Title
  if (!title) {
    errors.push('Título es requerido');
  } else if (title.length < 5 || title.length > 200) {
    errors.push('Título debe tener entre 5 y 200 caracteres');
  }

  // Description
  if (!description) {
    errors.push('Descripción es requerida');
  } else if (description.length < 10 || description.length > 2000) {
    errors.push('Descripción debe tener entre 10 y 2000 caracteres');
  }

  // Category
  const validCategories = [
    'mantenimiento-general',
    'seguridad',
    'infraestructura',
    'limpieza',
    'electricidad',
    'plomeria',
    'sistemas-tecnologia',
    'elevadores',
    'otros'
  ];
  if (!category) {
    errors.push('Categoría es requerida');
  } else if (!validCategories.includes(category)) {
    errors.push('Categoría inválida');
  }

  // Priority
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (!priority) {
    errors.push('Prioridad es requerida');
  } else if (!validPriorities.includes(priority)) {
    errors.push('Prioridad inválida');
  }

  // Location
  if (!location) {
    errors.push('Ubicación es requerida');
  } else {
    // Validar edificio/pabellón
    const validBuildings = [
      'edificio-principal',
      'nuevo-edificio',
      'auditorio',
      'aula-magna',
      'cancha-deportiva',
      'foyer',
      'otro'
    ];
    if (!location.building) {
      errors.push('Edificio/Pabellón es requerido');
    } else if (!validBuildings.includes(location.building)) {
      errors.push('Edificio/Pabellón inválido');
    } else if (location.building === 'otro') {
      // Si es "otro", debe tener un campo "otherBuilding" con el valor
      if (!location.otherBuilding || location.otherBuilding.trim().length < 1) {
        errors.push('Debe especificar el nombre del edificio/pabellón');
      } else if (location.otherBuilding.length > 100) {
        errors.push('Nombre del edificio/pabellón debe tener máximo 100 caracteres');
      }
    }
    
    // Validar piso: debe estar entre -2 y 11
    if (location.floor === undefined || location.floor < -2 || location.floor > 11) {
      errors.push('Piso debe estar entre -2 y 11');
    }
    
    // Validar sala/ambiente
    // Si es edificio principal o nuevo edificio, puede tener sala o pabellón/corredor
    if (location.building === 'edificio-principal' || location.building === 'nuevo-edificio') {
      // Puede ser un salón (con tipo L, M, A, E y números) o pabellón/corredor
      if (location.roomType === 'pabellon-corredor') {
        // Si es pabellón/corredor, no necesita número de salón
        if (!location.room || location.room.trim().length < 1) {
          errors.push('Debe especificar el pabellón/corredor');
        }
      } else {
        // Es un salón, debe tener tipo y número
        const validRoomTypes = ['L', 'M', 'A', 'E'];
        if (!location.roomType || !validRoomTypes.includes(location.roomType)) {
          errors.push('Tipo de salón es requerido (L, M, A, E)');
        }
        if (!location.roomNumber || location.roomNumber.length < 1 || location.roomNumber.length > 4) {
          errors.push('Número de salón es requerido y debe tener máximo 4 dígitos');
        }
        // Validar que roomNumber solo contenga números
        if (location.roomNumber && !/^\d{1,4}$/.test(location.roomNumber)) {
          errors.push('Número de salón debe contener solo números (máximo 4 dígitos)');
        }
      }
    } else if (location.building === 'otro') {
      // Para "otro", también necesita un campo de texto libre para sala/ambiente
      if (!location.room || location.room.trim().length < 1) {
        errors.push('Sala/Ambiente es requerido');
      } else if (location.room.length > 50) {
        errors.push('Sala/Ambiente debe tener máximo 50 caracteres');
      }
    } else {
      // Para otros edificios (auditorio, aula magna, etc.), solo necesita un campo de texto libre
      if (!location.room || location.room.trim().length < 1) {
        errors.push('Sala/Ambiente es requerido');
      } else if (location.room.length > 50) {
        errors.push('Sala/Ambiente debe tener máximo 50 caracteres');
      }
    }
  }

  // Images (opcional)
  if (images && images.length > 5) {
    errors.push('Máximo 5 imágenes permitidas');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida los datos para actualizar un incidente
 * @param {Object} data - Datos de actualización
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateUpdateIncident(data) {
  const errors = [];
  const { status, comment, priority } = data || {};

  // Status (opcional)
  if (status) {
    const validStatuses = ['pending', 'assigned', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      errors.push('Estado inválido');
    }
  }

  // Comment (opcional)
  if (comment && comment.length > 1000) {
    errors.push('Comentario debe tener máximo 1000 caracteres');
  }

  // Priority (opcional)
  if (priority) {
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      errors.push('Prioridad inválida');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida los datos para asignar un incidente
 * @param {Object} data - Datos de asignación
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAssignIncident(data) {
  const errors = [];
  const { workerId } = data || {};

  if (!workerId || workerId.length < 1) {
    errors.push('WorkerId es requerido');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ==========================================
// FUNCIONES DE VALIDACIÓN ESPECÍFICAS
// ==========================================

/**
 * Valida que la transición de estado sea válida
 * @param {string} currentStatus - Estado actual
 * @param {string} newStatus - Nuevo estado
 * @returns {boolean} True si la transición es válida
 */
export function validateIncidentStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    pending: ['assigned'],
    assigned: ['in_progress', 'pending'],
    in_progress: ['resolved', 'assigned'],
    resolved: ['closed', 'in_progress'],
    closed: []
  };

  const allowed = validTransitions[currentStatus] || [];
  return allowed.includes(newStatus);
}

/**
 * Retorna los puntos de carga según la prioridad
 * @param {string} priority - Prioridad del incidente
 * @returns {number} Puntos de carga
 */
export function getPriorityPoints(priority) {
  const priorityPoints = {
    low: 1,
    medium: 2,
    high: 4,
    urgent: 10
  };
  return priorityPoints[priority] || 2;
}

// Alias para compatibilidad
export const validatePriorityPoints = getPriorityPoints;

/**
 * Valida si el trabajador puede tomar otro incidente
 * @param {number} currentWorkload - Carga actual del trabajador
 * @param {string} incidentPriority - Prioridad del nuevo incidente
 * @param {number} maxWorkload - Carga máxima permitida (default: 20)
 * @returns {boolean} True si puede tomar el incidente
 */
export function validateWorkerCapacity(currentWorkload, incidentPriority, maxWorkload = 20) {
  const newPoints = getPriorityPoints(incidentPriority);
  return (currentWorkload + newPoints) <= maxWorkload;
}

/**
 * Valida formato de email
 * Acepta dominios .edu.pe comunes
 * @param {string} email - Email a validar
 * @returns {boolean}
 */
export function validateEmailFormat(email) {
  if (!email) return false;
  
  // Validación básica de email
  const basicPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!basicPattern.test(email)) return false;
  
  // Debe ser un dominio educativo peruano
  const eduPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.edu\.pe$/i;
  return eduPattern.test(email);
}

/**
 * Valida formato de teléfono peruano
 * @param {string} phone - Teléfono a validar
 * @returns {boolean}
 */
export function validatePhoneFormat(phone) {
  if (!phone) return false;
  
  // Debe empezar con +51 seguido de 9 dígitos
  const pattern = /^\+51\d{9}$/;
  return pattern.test(phone);
}

/**
 * Valida formato de código de estudiante
 * Formato flexible: acepta códigos de 4 a 15 caracteres alfanuméricos
 * @param {string} code - Código a validar
 * @returns {boolean}
 */
export function validateStudentCode(code) {
  if (!code) return false;
  const pattern = /^[a-zA-Z0-9]{4,15}$/;
  return pattern.test(code);
}

/**
 * Valida fortaleza de contraseña
 * Debe contener al menos: una mayúscula, una minúscula y un número
 * @param {string} password - Contraseña a validar
 * @returns {boolean}
 */
export function validatePasswordStrength(password) {
  if (!password) return false;
  
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);

  return hasUpperCase && hasLowerCase && hasNumber;
}

/**
 * Sanitiza un string eliminando caracteres peligrosos
 * @param {string} text - Texto a sanitizar
 * @returns {string} Texto sanitizado
 */
export function sanitizeString(text) {
  if (!text) return '';

  // Convertir a string si no lo es
  text = String(text);

  // Remover caracteres de control (excepto saltos de línea y tabs)
  let sanitized = text.split('').filter(char => {
    const code = char.charCodeAt(0);
    return code >= 32 || char === '\n' || char === '\t';
  }).join('');

  // Limitar longitud
  sanitized = sanitized.substring(0, 2000);

  return sanitized.trim();
}

/**
 * Determina el estado del trabajador según su carga
 * @param {number} workloadPoints - Puntos de carga actual
 * @returns {string} Estado: available, moderate o busy
 */
export function getWorkerStatus(workloadPoints) {
  if (workloadPoints <= 10) {
    return 'available';
  } else if (workloadPoints <= 15) {
    return 'moderate';
  } else {
    return 'busy';
  }
}

/**
 * Valida parámetros de query para listar incidentes
 * @param {Object} params - Parámetros de query
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateIncidentQueryParams(params) {
  const errors = [];
  const { status, priority, category, limit } = params || {};

  if (status) {
    const validStatuses = ['pending', 'assigned', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      errors.push('Estado inválido');
    }
  }

  if (priority) {
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      errors.push('Prioridad inválida');
    }
  }

  if (category) {
    const validCategories = [
      'mantenimiento-general',
      'seguridad',
      'infraestructura',
      'limpieza',
      'electricidad',
      'plomeria',
      'sistemas-tecnologia',
      'elevadores',
      'otros'
    ];
    if (!validCategories.includes(category)) {
      errors.push('Categoría inválida');
    }
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      errors.push('Límite debe estar entre 1 y 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida parámetros de query para listar trabajadores
 * @param {Object} params - Parámetros de query
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateWorkerQueryParams(params) {
  const errors = [];
  const { status, sortBy, order, limit } = params || {};

  if (status) {
    const validStatuses = ['available', 'moderate', 'busy'];
    if (!validStatuses.includes(status)) {
      errors.push('Estado inválido');
    }
  }

  if (sortBy) {
    const validSortBy = ['workload', 'name', 'activeIncidents'];
    if (!validSortBy.includes(sortBy)) {
      errors.push('Campo de ordenamiento inválido');
    }
  }

  if (order) {
    const validOrders = ['asc', 'desc'];
    if (!validOrders.includes(order)) {
      errors.push('Orden inválido. Debe ser asc o desc');
    }
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      errors.push('Límite debe estar entre 1 y 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}