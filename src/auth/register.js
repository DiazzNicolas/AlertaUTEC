/**
 * Lambda function: Registro de nuevos usuarios
 * Endpoint: POST /auth/register
 * 
 * Roles disponibles:
 * - alumno: Estudiantes que reportan incidentes
 * - worker: Personal de mantenimiento/técnico
 * - admin: Administrador del sistema
 */
import { v4 as uuidv4 } from 'uuid';
import { getUserByEmail, putItem } from '../utils/dynamodb.js';
import { hashPassword, generateToken } from '../utils/auth.js';
import { created, conflict, badRequest, internalError } from '../utils/responses.js';
import { validateRegisterUser, sanitizeString } from '../utils/validators.js';

const USERS_TABLE = process.env.USERS_TABLE;

/**
 * Handler para registrar un nuevo usuario en el sistema
 * 
 * Request Body:
 * {
 *   "email": "juan.perez@universidad.edu.pe",
 *   "password": "Password123!",
 *   "name": "Juan Pérez",
 *   "role": "alumno",
 *   "phone": "+51999123456",
 *   "studentCode": "2021100123",  // Solo para alumnos
 *   "faculty": "Ingeniería",      // Solo para alumnos
 *   "career": "Sistemas",         // Solo para alumnos
 *   "specialty": "Electricista",  // Solo para workers
 *   "department": "Mantenimiento" // Solo para workers
 * }
 */
export const handler = async (event) => {
  try {
    // Parsear body
    const body = JSON.parse(event.body || '{}');

    // Validar datos
    const validation = validateRegisterUser(body);
    if (!validation.valid) {
      return badRequest('Datos de registro inválidos', {
        errors: validation.errors
      });
    }

    const { email, password, name, role, phone, studentCode, faculty, career, specialty, department } = body;

    // Verificar si el email ya existe
    const existingUser = await getUserByEmail(email.toLowerCase());
    if (existingUser) {
      return conflict('El correo electrónico ya está registrado', {
        email: 'Este correo ya tiene una cuenta'
      });
    }

    // Generar ID único
    const userId = `usr_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const currentTimestamp = Date.now();

    // Hash de la contraseña
    const hashedPassword = await hashPassword(password);

    // Construir objeto de usuario base
    const userItem = {
      userId,
      email: email.toLowerCase(),
      password: hashedPassword,
      name: sanitizeString(name),
      role,
      phone: phone || null,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
      status: 'active'
    };

    // Agregar campos específicos según el rol
    if (role === 'alumno') {
      userItem.studentCode = studentCode;
      userItem.faculty = faculty ? sanitizeString(faculty) : null;
      userItem.career = career ? sanitizeString(career) : null;
    } else if (role === 'worker') {
      userItem.specialty = specialty ? sanitizeString(specialty) : 'General';
      userItem.department = department ? sanitizeString(department) : 'Mantenimiento';
      userItem.workloadPoints = 0;
      userItem.maxWorkloadPoints = 20;
      userItem.activeIncidents = 0;
      userItem.totalResolved = 0;
      userItem.avgResolutionTimeHours = 0;
      userItem.rating = 0;
    }

    // Guardar en DynamoDB
    await putItem(USERS_TABLE, userItem);

    // Generar token JWT
    const token = generateToken({
      userId,
      email: userItem.email,
      role: userItem.role,
      name: userItem.name
    });

    // Preparar respuesta (sin contraseña)
    const responseData = {
      token,
      user: {
        userId,
        email: userItem.email,
        name: userItem.name,
        role: userItem.role,
        phone: userItem.phone
      }
    };

    // Agregar campos adicionales según el rol
    if (role === 'alumno') {
      responseData.user.studentCode = userItem.studentCode;
      responseData.user.faculty = userItem.faculty;
      responseData.user.career = userItem.career;
    } else if (role === 'worker') {
      responseData.user.specialty = userItem.specialty;
      responseData.user.department = userItem.department;
      responseData.user.workloadPoints = 0;
      responseData.user.status = 'available';
    }

    return created('Usuario registrado exitosamente', responseData);

  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    console.error('Error en register:', error);
    return internalError('Error al registrar usuario');
  }
};