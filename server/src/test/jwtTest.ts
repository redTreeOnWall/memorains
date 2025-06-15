import { asyncSign, asyncVerify } from "../utils/jwtUtils";
import { awaitTime } from "../utils/utils";

export const testJwt = async () => {
  const token = await asyncSign({ name: "test", role: "admin", index: 29 }, 5);
  console.log(`token: ${token}`);

  await awaitTime(4 * 1000);
  const payload = await asyncVerify(token);
  console.log("payload:", payload);
};
