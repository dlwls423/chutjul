import { requireProfile, serviceRequest } from './auth';

export async function requireDocumentAccess(id: string) {
  const profile = await requireProfile({ approved: true });
  if (profile.id === 'public-test') throw new Error('FORBIDDEN');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('NOT_FOUND');
  const docs = await serviceRequest<{ source_file_id: string }[]>(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}&select=source_file_id&limit=1`);
  if (!docs[0]?.source_file_id) throw new Error('NOT_FOUND');
  // Processing department in the complaint is descriptive, not ownership.
  const sources = await serviceRequest<{ owning_department: string }[]>(`/rest/v1/source_files?id=eq.${encodeURIComponent(docs[0].source_file_id)}&select=owning_department&limit=1`);
  if (!sources[0] || (profile.role !== 'admin' && sources[0].owning_department !== profile.department)) throw new Error('FORBIDDEN');
  return profile;
}
