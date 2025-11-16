/**
 * Lambda function: Inicio de sesión
 * Endpoint: POST /auth/login
 */
import { getUserByEmail } from '../utils/dynamodb.js';
import { verifyPassword, generateToken } from '../utils/auth.js';
import { successResponse, unauthorized, badRequest, notFound, forbidden, internalError } from '../utils/responses.js';
import { validateLogin, getWorkerStatus } from '../utils/validators.js';

/**
 * Autentica un usuario y genera un token JWT
 * 
 * Request Body:
 * {
 *   "email": "juan.perez@universidad.edu.pe",
 *   "password": "Password123!"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Login exitoso",
 *   "data": {
 *     "token": "eyJhbGci...",
 *     "user": {
 *       "userId": "usr_xxx",
 *       "email": "...",
 *       "name": "...",
 *       "role": "alumno"
 *     }
 *   }
 * }
 */
export const handler = async (event) => {
  try {
    // Parsear body
    const body = JSON.parse(event.body || '{}');

    // Validar datos
    const validation = validateLogin(body);
    if (!validation.valid) {
      return badRequest('Datos de login inválidos', {
        errors: validation.errors
      });
    }

    const { email, password } = body;

    // Buscar usuario por email
    const user = await getUserByEmail(email.toLowerCase());

    if (!user) {
      return notFound('Usuario no encontrado');
    }

    // Verificar si el usuario está activo
    if (user.status !== 'active') {
      return forbidden('Cuenta inactiva. Contacta al administrador');
    }

    // Verificar contraseña
    const passwordMatch = await verifyPassword(password, user.password);
    if (!passwordMatch) {
      return unauthorized('Credenciales inválidas');
    }

    // Generar token JWT
    const token = generateToken({
      userId: user.userId,
      email: user.email,
      role: user.role,
      name: user.name
    });

    // Preparar datos del usuario (sin contraseña)
    const userResponse = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone || null
    };

    // Agregar campos específicos según el rol
    if (user.role === 'alumno') {
      userResponse.studentCode = user.studentCode;
      userResponse.faculty = user.faculty;
      userResponse.career = user.career;
    } else if (user.role === 'worker') {
      userResponse.specialty = user.specialty;
      userResponse.department = user.department;
      userResponse.workloadPoints = user.workloadPoints || 0;
      userResponse.activeIncidents = user.activeIncidents || 0;
      userResponse.status = getWorkerStatus(user.workloadPoints || 0);
    }

    const responseData = {
      token,
      user: userResponse
    };

    return successResponse('Login exitoso', responseData);

  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    console.error('Error en login:', error);
    return internalError('Error al iniciar sesión');
  }
};