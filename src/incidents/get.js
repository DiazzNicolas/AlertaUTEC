/**
 * Lambda function: Obtener detalle de un incidente
 * Endpoint: GET /incidents/{id}
 * Requiere: Autenticación
 */
import { getIncidentById, getUserById } from '../utils/dynamodb.js';
import { requireAuth, isStudent } from '../utils/auth.js';
import { successResponse, unauthorized, notFound, forbidden, internalError } from '../utils/responses.js';
import { getImageUrl } from '../utils/s3.js';

/**
 * Obtiene el detalle completo de un incidente
 * 
 * Path Parameters:
 * - id: incidentId
 */
export const handler = async (event) => {
  try {
    // Verificar autenticación
    let user;
    try {
      user = requireAuth(event);
    } catch (error) {
      return unauthorized(error.message);
    }

    // Obtener incidentId del path
    const incidentId = event.pathParameters?.id;

    if (!incidentId) {
      return notFound('ID de incidente no proporcionado');
    }

    // Obtener incidente
    const incident = await getIncidentById(incidentId);

    if (!incident) {
      return notFound(`Incidente ${incidentId} no encontrado`);
    }

    // Verificar permisos
    // Estudiantes solo pueden ver sus propios incidentes
    if (isStudent(user) && incident.reportedBy !== user.userId) {
      return forbidden('No tienes permiso para ver este incidente');
    }

    // Obtener información del reportador
    let reporterInfo = null;
    if (incident.reportedBy) {
      const reporter = await getUserById(incident.reportedBy);
      if (reporter) {
        reporterInfo = {
          userId: reporter.userId,
          name: reporter.name,
          email: reporter.email,
          phone: reporter.phone
        };
        if (reporter.studentCode) {
          reporterInfo.studentCode = reporter.studentCode;
        }
        if (reporter.faculty) {
          reporterInfo.faculty = reporter.faculty;
        }
      }
    }

    // Obtener información del trabajador asignado
    let workerInfo = null;
    if (incident.assignedTo) {
      const worker = await getUserById(incident.assignedTo);
      if (worker) {
        workerInfo = {
          userId: worker.userId,
          name: worker.name,
          email: worker.email,
          phone: worker.phone,
          specialty: worker.specialty,
          department: worker.department,
          workloadPoints: worker.workloadPoints || 0
        };
      }
    }

    // Generar URLs pre-firmadas para las imágenes
    const imageUrls = [];
    if (incident.images && incident.images.length > 0) {
      for (const s3Key of incident.images) {
        try {
          const url = await getImageUrl(s3Key, 3600); // 1 hora
          imageUrls.push(url);
        } catch (error) {
          console.error(`Error generando URL para ${s3Key}:`, error.message);
        }
      }
    }

    // Enriquecer comentarios con info de usuarios
    const comments = incident.comments || [];
    const enrichedComments = [];
    
    for (const comment of comments) {
      const enrichedComment = { ...comment };

      // Si el comentario tiene userId, obtener info del usuario
      if (comment.userId) {
        const commentUser = await getUserById(comment.userId);
        if (commentUser) {
          enrichedComment.userName = commentUser.name || 'Usuario';
          enrichedComment.userRole = commentUser.role;
        }
      }

      enrichedComments.push(enrichedComment);
    }

    // Construir respuesta
    const incidentDetail = {
      incidentId: incident.incidentId,
      title: incident.title,
      description: incident.description,
      category: incident.category,
      priority: incident.priority,
      status: incident.status,
      location: incident.location,
      images: imageUrls,
      reportedBy: reporterInfo,
      assignedTo: workerInfo,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt || null,
      comments: enrichedComments
    };

    return successResponse(
      'Incidente obtenido exitosamente',
      incidentDetail
    );

  } catch (error) {
    console.error('Error en get incident:', error);
    return internalError('Error al obtener incidente');
  }
};