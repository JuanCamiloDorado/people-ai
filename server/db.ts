import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { getDbSsl } from "./dbSsl";
import {
  appProfiles,
  companies,
  departments,
  employees,
  knowledgeBaseDocuments,
  recruitmentCandidates,
  users,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;
let _migrated = false;

async function ensureSchema(db: ReturnType<typeof drizzle>) {
  if (_migrated) return;
  _migrated = true;
  try {
    try {
      await db.execute(
        sql`ALTER TABLE \`job_positions\` ADD COLUMN \`templateId\` INT NULL;`
      );
    } catch {
      // Column might already exist
    }

    try {
      await db.execute(
        sql`ALTER TABLE \`hiring_processes\` ADD COLUMN \`documentDeadline\` TIMESTAMP NULL;`
      );
    } catch {
      // Column might already exist
    }

    try {
      await db.execute(
        sql`ALTER TABLE \`hiring_requirements\` ADD COLUMN \`allowedMimeTypes\` VARCHAR(300) NULL;`
      );
    } catch {
      // Column might already exist
    }

    // Contacto de soporte del portal del candidato. Dos ALTER separados y no uno con dos
    // ADD: si una de las dos columnas ya existe, MySQL aborta la sentencia entera y la
    // otra no llegaria a crearse nunca.
    try {
      await db.execute(
        sql`ALTER TABLE \`companies\` ADD COLUMN \`candidateSupportEmail\` VARCHAR(320) NULL;`
      );
    } catch {
      // Column might already exist
    }

    try {
      await db.execute(
        sql`ALTER TABLE \`companies\` ADD COLUMN \`candidateSupportPhone\` VARCHAR(40) NULL;`
      );
    } catch {
      // Column might already exist
    }

    try {
      await db.execute(
        sql`ALTER TABLE \`document_templates\` MODIFY COLUMN \`positionId\` INT NULL;`
      );
    } catch {
      // positionId modify
    }

    try {
      await db.execute(sql`
        UPDATE \`job_positions\` jp
        JOIN \`document_templates\` dt ON dt.positionId = jp.id AND dt.companyId = jp.companyId AND dt.status = 'active'
        SET jp.templateId = dt.id
        WHERE jp.templateId IS NULL;
      `);
    } catch {
      // ignore
    }

    try {
      // Consolidate duplicate active standard templates per company
      await db.execute(sql`
        UPDATE \`document_templates\` d1
        JOIN \`document_templates\` d2 ON d1.companyId = d2.companyId
          AND d1.name = d2.name
          AND d1.name = 'Expediente de Ingreso Estándar'
          AND d1.status = 'active'
          AND d2.status = 'active'
          AND d1.id > d2.id
        SET d1.status = 'archived';
      `);
    } catch {
      // ignore
    }
  } catch (error) {
    console.warn("[Database] Schema sync notice:", error);
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle({
        connection: {
          uri: process.env.DATABASE_URL,
          ssl: getDbSsl(process.env.DATABASE_URL),
          // Ajustes del pool para TiDB Cloud. `maxIdle` DEBE ser estrictamente
          // menor que `connectionLimit`: mysql2 solo arranca el recolector de
          // conexiones ociosas si se cumple esa desigualdad (mysql2/lib/base/pool.js),
          // y por defecto `maxIdle` hereda el mismo valor que `connectionLimit`, asi
          // que la condicion era falsa, el recolector nunca se creaba e `idleTimeout`
          // era codigo muerto. El endpoint publico de TiDB en AWS corta las
          // conexiones ociosas en silencio a los 340 s, con lo que la primera
          // peticion tras un rato de calma sacaba del pool un socket ya muerto y
          // moria con ECONNRESET. Con maxIdle 2 < connectionLimit 5 el recolector
          // existe e `idleTimeout` (60 s, muy por debajo de esos 340 s) se aplica.
          connectionLimit: 5,
          maxIdle: 2,
          idleTimeout: 60_000,
          // Con la base caida, fallar rapido en vez de colgar la primera peticion
          // hasta el timeout del sistema operativo.
          connectTimeout: 10_000,
        },
      });
      await ensureSchema(_db);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** Igual que `getDb()` pero lanza en vez de devolver null.
 *
 *  Los helpers de este archivo devuelven []/undefined cuando no hay conexion, lo
 *  que en lectura es tolerable pero en autenticacion no: un registro "exitoso" que
 *  no escribio nada seria peor que un error. Todo el camino de auth usa esta version. */
export async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "No hay conexion con la base de datos. Revisa DATABASE_URL antes de autenticar."
    );
  }
  return db;
}

export async function getUserByEmail(email: string) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await requireDb();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function getAppProfile(userId: number, companyId?: number | null) {
  const db = await getDb();
  if (!db) return undefined;
  // Solo perfiles activos. Sin este filtro, suspender a alguien en app_profiles no
  // le quitaba ningun acceso: `resolveAccess` deriva de aqui el rol y la empresa en
  // cada peticion, y devolvia el perfil suspendido igual que cualquier otro.
  const conditions =
    companyId == null
      ? and(eq(appProfiles.userId, userId), eq(appProfiles.status, "active"))
      : and(
          eq(appProfiles.userId, userId),
          eq(appProfiles.companyId, companyId),
          eq(appProfiles.status, "active")
        );
  // Orden explicito: sin el, un usuario con perfil en varias empresas obtendria
  // una al azar segun el plan de ejecucion.
  const result = await db
    .select()
    .from(appProfiles)
    .where(conditions)
    .orderBy(asc(appProfiles.id))
    .limit(1);
  return result[0];
}

/** Empresas a las que pertenece el usuario, con el rol en cada una. Alimenta el
 *  selector de empresa y solo se consulta desde `access.me`. */
export async function listMemberships(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return (
    db
      .select({
        companyId: appProfiles.companyId,
        companyName: companies.name,
        role: appProfiles.role,
        status: appProfiles.status,
      })
      .from(appProfiles)
      .innerJoin(companies, eq(appProfiles.companyId, companies.id))
      // Solo perfiles activos: uno suspendido no debe poder recuperar su rol
      // anterior con un clic en el selector de empresa.
      .where(
        and(eq(appProfiles.userId, userId), eq(appProfiles.status, "active"))
      )
      .orderBy(asc(companies.name))
  );
}

export async function listCompanies() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companies).orderBy(asc(companies.name));
}

export async function listDepartmentsByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(departments)
    .where(eq(departments.companyId, companyId))
    .orderBy(asc(departments.name));
}

export async function listRecruitmentByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(recruitmentCandidates)
    .where(eq(recruitmentCandidates.companyId, companyId))
    .orderBy(asc(recruitmentCandidates.updatedAt));
}

export async function listKnowledgeByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(knowledgeBaseDocuments)
    .where(eq(knowledgeBaseDocuments.companyId, companyId))
    .orderBy(asc(knowledgeBaseDocuments.title));
}

export async function listEmployeesByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(employees)
    .where(eq(employees.companyId, companyId))
    .orderBy(asc(employees.lastName));
}
