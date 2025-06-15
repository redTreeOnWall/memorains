import { JwtPayload } from "jsonwebtoken";

export interface UserJwtPayload {
  userId: string;
  lastLoginTime: number;
  expiresIn: number;
}

declare global {
  namespace Express {
    export interface Request {
      token?: UserJwtPayload & JwtPayload;
    }
  }
}
