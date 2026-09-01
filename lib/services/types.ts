export interface PresignRequest {
  objectKey: string;
  contentType?: string;
  expiresIn?: number;
}
