/**
 * Lambda Authorizer: Valida JWT tokens para proteger endpoints
 * Tipo: REQUEST authorizer
 */
import { decodeToken, extractTokenFromHeader } from '../utils/auth.js';

/**
 * Lambda Authorizer para API Gateway
 * 
 * Valida el token JWT y retorna una política de acceso IAM
 * 
 * Event structure:
 * {
 *   "type": "REQUEST",
 *   "methodArn": "arn:aws:execute-api:...",
 *   "headers": {
 *     "Authorization": "Bearer <token>"
 *   }
 * }
 * 
 * Returns:
 * {
 *   "principalId": "user_id",
 *   "policyDocument": {
 *     "Version": "2012-10-17",
 *     "Statement": [...]
 *   },
 *   "context": {
 *     "userId": "...",
 *     "role": "...",
 *     "email": "..."
 *   }
 * }
 */
export const handler = async (event) => {
  try {
    console.log('Authorizer event:', JSON.stringify(event));

    // Extraer el token del header Authorization
    const headers = event.headers || {};

    // Buscar Authorization header (case-insensitive)
    let authHeader = null;
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'authorization') {
        authHeader = value;
        break;
      }
    }

    if (!authHeader) {
      console.log('No Authorization header found');
      throw new Error('Unauthorized');
    }

    // Extraer token
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      console.log('Invalid token format');
      throw new Error('Unauthorized');
    }

    // Decodificar y validar token
    const payload = decodeToken(token);

    if (!payload) {
      console.log('Invalid or expired token');
      throw new Error('Unauthorized');
    }

    // Extraer información del usuario
    const userId = payload.userId;
    const role = payload.role;
    const email = payload.email;
    const name = payload.name;

    if (!userId || !role) {
      console.log('Missing required fields in token');
      throw new Error('Unauthorized');
    }

    console.log(`Token validated for user: ${userId} (${role})`);

    // Generar política de acceso
    const policy = generatePolicy(
      userId,
      'Allow',
      event.methodArn,
      {
        userId,
        role,
        email,
        name
      }
    );

    return policy;

  } catch (error) {
    console.error('Authorizer error:', error.message);
    // Retornar Deny si hay cualquier error
    throw new Error('Unauthorized');
  }
};

/**
 * Genera una política de acceso IAM
 * 
 * @param {string} principalId - ID del usuario (principalId)
 * @param {string} effect - 'Allow' o 'Deny'
 * @param {string} resource - ARN del recurso (methodArn)
 * @param {Object} context - Contexto adicional a pasar a la función Lambda
 * @returns {Object} Política IAM
 */
function generatePolicy(principalId, effect, resource, context = null) {
  const authResponse = {
    principalId
  };

  if (effect && resource) {
    const policyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource
        }
      ]
    };
    authResponse.policyDocument = policyDocument;
  }

  // Agregar contexto (será accesible en las funciones Lambda)
  if (context) {
    // API Gateway requiere que todos los valores del contexto sean strings
    authResponse.context = {};
    for (const [key, value] of Object.entries(context)) {
      authResponse.context[key] = String(value);
    }
  }

  return authResponse;
}

/**
 * Helper para generar política Allow
 * @param {string} principalId - ID del usuario
 * @param {string} resource - ARN del recurso
 * @param {Object} context - Contexto adicional
 * @returns {Object} Política Allow
 */
export function generateAllowPolicy(principalId, resource, context = null) {
  return generatePolicy(principalId, 'Allow', resource, context);
}

/**
 * Helper para generar política Deny
 * @param {string} principalId - ID del usuario
 * @param {string} resource - ARN del recurso
 * @returns {Object} Política Deny
 */
export function generateDenyPolicy(principalId, resource) {
  return generatePolicy(principalId, 'Deny', resource);
}