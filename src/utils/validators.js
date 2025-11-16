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
  const { email, password, name, role, phone, studentCode, specialty } = data;

  // Email
  if (!email) {
    errors.push('Email es requerido');
  } else if (!validateEmailFormat(email)) {
    errors.push('Debe usar un correo institucional (@universidad.edu.pe)');
  }

  // Password
  if (!password) {
    errors.push('Password es requerido');
  } else if (password.length < 8 || password.length > 100) {
    errors.push('Password debe tener entre 8 y 100 caracteres');
  } else if (!validatePasswordStrength(password)) {
    errors.push('Password debe contener al menos una mayúscula, una minúscula y un número');
  }

  // Name
  if (!name) {
    errors.push('Nombre es requerido');
  } else if (name.length < 2 || name.length > 100) {
    errors.push('Nombre debe tener entre 2 y 100 caracteres');
  }

  // Role
  const validRoles = ['alumno', 'worker', 'admin'];
  if (!role) {
    errors.push('Rol es requerido');
  } else if (!validRoles.includes(role)) {
    errors.push('Rol inválido. Debe ser: alumno, worker o admin');
  }

  // Phone (opcional)
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
    if (!location.building || location.building.length < 1 || location.building.length > 100) {
      errors.push('Edificio debe tener entre 1 y 100 caracteres');
    }
    if (location.floor === undefined || location.floor < 0 || location.floor > 20) {
      errors.push('Piso debe estar entre 0 y 20');
    }
    if (!location.room || location.room.length < 1 || location.room.length > 50) {
      errors.push('Sala/Ambiente debe tener entre 1 y 50 caracteres');
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
  const { status, comment, priority } = data;

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
  const { workerId } = data;

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
 * 
 * Estados permitidos: pending -> assigned -> in_progress -> resolved -> closed
 * 
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
    closed: [] // No se puede cambiar desde cerrado
  };

  const allowed = validTransitions[currentStatus] || [];
  return allowed.includes(newStatus);
}

/**
 * Retorna los puntos de carga según la prioridad
 * 
 * @param {string} priority - Prioridad del incidente
 * @returns {number} Puntos de carga
 */
export function validatePriorityPoints(priority) {
  const priorityPoints = {
    low: 1,
    medium: 2,
    high: 4,
    urgent: 10
  };
  return priorityPoints[priority] || 2;
}

/**
 * Valida si el trabajador puede tomar otro incidente
 * 
 * @param {number} currentWorkload - Carga actual del trabajador
 * @param {string} incidentPriority - Prioridad del nuevo incidente
 * @param {number} maxWorkload - Carga máxima permitida (default: 20)
 * @returns {boolean} True si puede tomar el incidente
 */
export function validateWorkerCapacity(currentWorkload, incidentPriority, maxWorkload = 20) {
  const newPoints = validatePriorityPoints(incidentPriority);
  return (currentWorkload + newPoints) <= maxWorkload;
}

/**
 * Valida formato de email universitario
 * @param {string} email - Email a validar
 * @returns {boolean}
 */
export function validateEmailFormat(email) {
  const pattern = /^[a-zA-Z0-9._%+-]+@universidad\.edu\.pe$/;
  return pattern.test(email);
}

/**
 * Valida formato de teléfono peruano
 * @param {string} phone - Teléfono a validar
 * @returns {boolean}
 */
export function validatePhoneFormat(phone) {
  const pattern = /^\+51\d{9}$/;
  return pattern.test(phone);
}

/**
 * Valida formato de código de estudiante
 * Formato: 10 dígitos (año + código)
 * @param {string} code - Código a validar
 * @returns {boolean}
 */
export function validateStudentCode(code) {
  const pattern = /^\d{10}$/;
  return pattern.test(code);
}

/**
 * Valida fortaleza de contraseña
 * Debe contener al menos: una mayúscula, una minúscula y un número
 * @param {string} password - Contraseña a validar
 * @returns {boolean}
 */
export function validatePasswordStrength(password) {
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);

  return hasUpperCase && hasLowerCase && hasNumber;
}

/**
 * Sanitiza un string eliminando caracteres peligrosos
 * 
 * @param {string} text - Texto a sanitizar
 * @returns {string} Texto sanitizado
 */
export function sanitizeString(text) {
  if (!text) return '';

  // Remover caracteres de control (excepto saltos de línea)
  let sanitized = text.split('').filter(char => {
    const code = char.charCodeAt(0);
    return code >= 32 || char === '\n';
  }).join('');

  // Limitar longitud
  sanitized = sanitized.substring(0, 2000);

  return sanitized.trim();
}

/**
 * Determina el estado del trabajador según su carga
 * 
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
  const { status, priority, category, limit } = params;

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
  const { status, sortBy, order, limit } = params;

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