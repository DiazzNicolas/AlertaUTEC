/**
 * Utilidades para generar respuestas HTTP estandarizadas
 */

/**
 * Genera una respuesta exitosa estandarizada
 * 
 * @param {string} message - Mensaje descriptivo del éxito
 * @param {*} [data=null] - Datos a retornar (opcional)
 * @param {number} [statusCode=200] - Código HTTP (default: 200)
 * @returns {Object} Respuesta con statusCode, headers y body
 */
export function successResponse(message, data = null, statusCode = 200) {
  const body = {
    success: true,
    message
  };

  if (data !== null) {
    body.data = data;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify(body)
  };
}

/**
 * Genera una respuesta de error estandarizada
 * 
 * @param {string} message - Mensaje descriptivo del error
 * @param {number} [statusCode=400] - Código HTTP de error
 * @param {string} [errorType=null] - Tipo de error (opcional)
 * @param {Object} [details=null] - Detalles adicionales del error (opcional)
 * @returns {Object} Respuesta con statusCode, headers y body
 */
export function errorResponse(message, statusCode = 400, errorType = null, details = null) {
  const body = {
    success: false,
    message
  };

  if (errorType) {
    body.error = errorType;
  }

  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify(body)
  };
}

/**
 * Respuesta 400 - Bad Request
 * @param {string} [message='Solicitud inválida'] - Mensaje de error
 * @param {Object} [details=null] - Detalles del error
 * @returns {Object} Respuesta HTTP
 */
export function badRequest(message = 'Solicitud inválida', details = null) {
  return errorResponse(message, 400, 'BAD_REQUEST', details);
}

/**
 * Respuesta 401 - Unauthorized
 * @param {string} [message='No autorizado'] - Mensaje de error
 * @returns {Object} Respuesta HTTP
 */
export function unauthorized(message = 'No autorizado') {
  return errorResponse(message, 401, 'UNAUTHORIZED');
}

/**
 * Respuesta 403 - Forbidden
 * @param {string} [message='Acceso denegado'] - Mensaje de error
 * @returns {Object} Respuesta HTTP
 */
export function forbidden(message = 'Acceso denegado') {
  return errorResponse(message, 403, 'FORBIDDEN');
}

/**
 * Respuesta 404 - Not Found
 * @param {string} [message='Recurso no encontrado'] - Mensaje de error
 * @returns {Object} Respuesta HTTP
 */
export function notFound(message = 'Recurso no encontrado') {
  return errorResponse(message, 404, 'NOT_FOUND');
}

/**
 * Respuesta 409 - Conflict
 * @param {string} [message='Conflicto con el estado actual'] - Mensaje de error
 * @param {Object} [details=null] - Detalles del conflicto
 * @returns {Object} Respuesta HTTP
 */
export function conflict(message = 'Conflicto con el estado actual', details = null) {
  return errorResponse(message, 409, 'CONFLICT', details);
}

/**
 * Respuesta 500 - Internal Server Error
 * @param {string} [message='Error interno del servidor'] - Mensaje de error
 * @returns {Object} Respuesta HTTP
 */
export function internalError(message = 'Error interno del servidor') {
  return errorResponse(message, 500, 'INTERNAL_ERROR');
}

/**
 * Respuesta 201 - Created
 * @param {string} message - Mensaje de éxito
 * @param {*} [data=null] - Datos creados
 * @returns {Object} Respuesta HTTP
 */
export function created(message, data = null) {
  return successResponse(message, data, 201);
}

/**
 * Respuesta 204 - No Content
 * @returns {Object} Respuesta HTTP
 */
export function noContent() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true
    },
    body: ''
  };
}

export {
  successResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
  created,
  noContent
};