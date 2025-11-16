/**
 * Lambda function: Registro de nuevos usuarios
 * Endpoint: POST /auth/register
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
    console.log('=== INICIO REGISTER ===');
    console.log('Body recibido:', event.body);
    
    // Parsear body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
      console.log('Body parseado exitosamente:', JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error('Error parseando JSON:', parseError);
      return badRequest('Formato JSON inválido');
    }

    // Validar datos
    console.log('Validando datos...');
    const validation = validateRegisterUser(body);
    console.log('Resultado validación:', validation);
    
    if (!validation.valid) {
      console.log('Validación falló con errores:', validation.errors);
      return badRequest('Datos de registro inválidos', {
        errors: validation.errors
      });
    }

    const { 
      email, 
      password, 
      name, 
      role, 
      phone, 
      studentCode, 
      faculty, 
      career, 
      specialty, 
      department 
    } = body;

    // Verificar si el email ya existe
    console.log('Verificando si email existe:', email.toLowerCase());
    const existingUser = await getUserByEmail(email.toLowerCase());
    
    if (existingUser) {
      console.log('Email ya existe');
      return conflict('El correo electrónico ya está registrado', {
        email: 'Este correo ya tiene una cuenta'
      });
    }
    console.log('Email disponible');

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
    console.log('Guardando usuario en DynamoDB...');
    await putItem(USERS_TABLE, userItem);
    console.log('Usuario guardado exitosamente');

    // Generar token JWT
    console.log('Generando token JWT...');
    const token = generateToken({
      userId,
      email: userItem.email,
      role: userItem.role,
      name: userItem.name
    });
    console.log('Token generado');

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

    console.log('=== REGISTRO EXITOSO ===');
    console.log('UserId:', userId);
    return created('Usuario registrado exitosamente', responseData);

  } catch (error) {
    console.error('=== ERROR EN REGISTER ===');
    console.error('Tipo de error:', error.name);
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    
    if (error instanceof SyntaxError) {
      return badRequest('Formato JSON inválido');
    }

    return internalError('Error al registrar usuario');
  }
};