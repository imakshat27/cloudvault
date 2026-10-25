import express from "express";
import { db } from "../db/db.js";
import { requireAuth } from "../middleware/auth.js";
import { visibleConversation } from "../services/conversations.js";
const router = express.Router();
router.use(requireAuth);
router.param("id", (req, res, next, id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? next()
    : res.status(400).json({ error: "Invalid conversation ID" }),
);
router.get("/", async (req, res, next) => {
  try {
    res.json({ conversations: await db.listConversations(req.user.id) });
  } catch (e) {
    next(e);
  }
});
router.post("/", async (req, res, next) => {
  try {
    const title = req.body.title ?? "New conversation";
    if (typeof title !== "string" || !title.trim() || title.length > 120)
      return res.status(400).json({ error: "Title must be 1–120 characters" });
    res
      .status(201)
      .json({
        conversation: await db.createConversation(req.user.id, title.trim()),
      });
  } catch (e) {
    next(e);
  }
});
router.get("/:id", async (req, res, next) => {
  try {
    const c = await db.getConversation(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: "Conversation not found" });
    res.json({ conversation: await visibleConversation(c, req.user.id) });
  } catch (e) {
    next(e);
  }
});
router.delete("/:id", async (req, res, next) => {
  try {
    if (!(await db.deleteConversation(req.params.id, req.user.id)))
      return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
export default router;
