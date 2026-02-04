import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();

app.use(express.json());

// CORS Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
  }),
);

app.get('/', (_req: Request, res: Response) => {
  res.send('Server is running');
});

export default app;
