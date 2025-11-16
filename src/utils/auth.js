/**
 * Utilidades de autenticación y autorización
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// JWT Secret desde variable de entorno
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRATION_HOURS = 24;

/**
 * Hashea una contraseña usando bcrypt
 * 
 * @param {string} password - Contraseña en texto plano
 * @returns {Promise<string>} Hash de la contraseña
 */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Verifica si una contraseña coincide con su hash
 * 
 * @param {string} password - Contraseña en texto plano
 * @param {string} hashedPassword - Hash almacenado
 * @returns {Promise<boolean>} True si coinciden
 */
export async function verifyPassword(password, hashedPassword) {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    console.error('Error verificando contraseña:', error);
    return false;
  }
}

/**
 * Genera un JWT token para un usuario
 * 
 * @param {Object} userData - Datos del usuario (userId, email, role, name)
 * @returns {string} JWT token
 */
export function generateToken(userData) {
  const payload = {
    userId: userData.userId,
    email: userData.email,
    role: userData.role,
    name: userData.name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (JWT_EXPIRATION_HOURS * 60 * 60)
  };

  return jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM });
}

/**
 * Decodifica y valida un JWT token
 * 
 * @param {string} token - JWT token
 * @returns {Object|null} Payload del token o null si es inválido
 */
export function decodeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log('Token expirado');
    } else if (error.name === 'JsonWebTokenError') {
      console.log('Token inválido:', error.message);
    }
    return null;
  }
}

/**
 * Extrae el token del header Authorization
 * 
 * @param {string} authorizationHeader - Header "Authorization: Bearer <token>"
 * @returns {string|null} Token o null
 */
export function extractTokenFromHeader(authorizationHeader) {
  if (!authorizationHeader) {
    return null;
  }

  const parts = authorizationHeader.split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Extrae los datos del usuario autenticado desde el evento Lambda
 * 
 * @param {Object} event - Evento de Lambda
 * @returns {Object|null} Datos del usuario o null
 */
export function getUserFromEvent(event) {
  const headers = event.headers || {};

  // Buscar el header Authorization (case-insensitive)
  let authHeader = null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      authHeader = value;
      break;
    }
  }

  if (!authHeader) {
    return null;
  }

  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return null;
  }

  return decodeToken(token);
}

/**
 * Valida que el request tenga un token válido
 * Lanza excepción si no está autenticado
 * 
 * @param {Object} event - Evento de Lambda
 * @returns {Object} Datos del usuario
 * @throws {Error} Si no está autenticado
 */
export function requireAuth(event) {
  const user = getUserFromEvent(event);

  if (!user) {
    throw new Error('No autorizado - Token inválido o ausente');
  }

  return user;
}

/**
 * Valida que el usuario tenga uno de los roles permitidos
 * 
 * @param {Object} event - Evento de Lambda
 * @param {string[]} allowedRoles - Lista de roles permitidos
 * @returns {Object} Datos del usuario
 * @throws {Error} Si no tiene permisos
 */
export function requireRole(event, allowedRoles) {
  const user = requireAuth(event);

  if (!allowedRoles.includes(user.role)) {
    throw new Error(`Acceso denegado - Requiere rol: ${allowedRoles.join(', ')}`);
  }

  return user;
}

/**
 * Verifica si el usuario es administrador
 * @param {Object} user - Datos del usuario
 * @returns {boolean}
 */
export function isAdmin(user) {
  return user.role === 'admin';
}

/**
 * Verifica si el usuario es trabajador
 * @param {Object} user - Datos del usuario
 * @returns {boolean}
 */
export function isWorker(user) {
  return user.role === 'worker';
}

/**
 * Verifica si el usuario es alumno
 * @param {Object} user - Datos del usuario
 * @returns {boolean}
 */
export function isStudent(user) {
  return user.role === 'alumno';
}

/**
 * Verifica si el usuario puede actualizar un incidente
 * 
 * @param {Object} user - Datos del usuario
 * @param {Object} incident - Datos del incidente
 * @returns {boolean} True si puede actualizar
 */
export function canUpdateIncident(user, incident) {
  // Admin puede actualizar cualquier incidente
  if (isAdmin(user)) {
    return true;
  }

  // Worker puede actualizar incidentes asignados a él
  if (isWorker(user)) {
    return incident.assignedTo === user.userId;
  }

  // Alumno solo puede comentar en sus propios incidentes
  if (isStudent(user)) {
    return incident.reportedBy === user.userId;
  }

  return false;
}

/**
 * Verifica si el usuario puede asignar incidentes
 * Solo administradores pueden asignar
 * 
 * @param {Object} user - Datos del usuario
 * @returns {boolean} True si puede asignar
 */
export function canAssignIncident(user) {
  return isAdmin(user);
}

/**
 * Genera un token para resetear contraseña
 * 
 * @param {string} userId - ID del usuario
 * @returns {string} Token de reseteo
 */
export function generatePasswordResetToken(userId) {
  const payload = {
    userId,
    type: 'password_reset',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60) // Expira en 1 hora
  };

  return jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM });
}

/**
 * Verifica un token de reseteo de contraseña
 * 
 * @param {string} token - Token de reseteo
 * @returns {string|null} userId si es válido, null si no
 */
export function verifyPasswordResetToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

    if (payload.type !== 'password_reset') {
      return null;
    }

    return payload.userId;
  } catch (error) {
    return null;
  }
}