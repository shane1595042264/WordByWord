import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
// Corrected import path and name to use the provided userRepository object
// Assuming a relative path from WordByWord/src/lib/auth/ to nibble-api/src/repositories/
// This path might need adjustment based on the actual project structure.
import { userRepository } from '../../../../nibble-api/src/repositories/user.repository';
// For password verification, we need a bcrypt-like library. Assuming it's available.
// This is a functional dependency not covered by the provided changes.
import bcrypt from 'bcryptjs'; // Assuming bcryptjs is installed and available

// Augment NextAuth types to include 'id' and 'role'
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: 'admin' | 'user';
    };
  }

  interface User {
    id: string;
    role: 'admin' | 'user';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'admin' | 'user';
  }
}


export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Use the imported userRepository object directly
        const user = await userRepository.findByEmail(credentials.email)

        // The original userRepository had a verifyPassword method.
        // The provided nibble-api/src/repositories/user.repository.ts does not.
        // We need to implement password verification here or assume it's handled elsewhere.
        // For compilation, we'll assume a bcrypt comparison.
        if (user && user.passwordHash && (await bcrypt.compare(credentials.password, user.passwordHash))) {
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.avatarUrl, // Map avatarUrl to image
            role: user.authRole as 'admin' | 'user', // Map authRole to role
          }
        }
        return null
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        if (!user.email) {
          console.error("Google sign-in attempted without an email address.");
          return false;
        }

        let existingUser = await userRepository.findByEmail(user.email); // Use findByEmail

        if (!existingUser) {
          // User does not exist, create a new user
          // The original createFromOAuth is not available. Using userRepository.create.
          // Note: userRepository.create expects an object with specific fields.
          existingUser = await userRepository.create({
            email: user.email,
            name: user.name,
            avatarUrl: user.image, // Map user.image to avatarUrl
            authRole: 'user', // Default role for new users
            googleId: account.providerAccountId, // Link Google ID directly on creation
          });

          // The original linkAccount method is not available.
          // For Google, we've already set googleId during creation.
          // If other providers or more complex linking is needed, this logic needs expansion.
          // For now, we assume setting googleId on creation is sufficient for Google.
          // If the user already existed and didn't have a googleId, we'd update it below.

          // Update the NextAuth user object with the actual database user ID and role
          user.id = existingUser.id;
          user.role = existingUser.authRole as 'admin' | 'user'; // Use augmented type
          return true; // Allow sign-in
        } else {
          // User exists. Check if this specific Google account is already linked.
          // The original getByProviderAccount is not available.
          // We'll check if the existing user's googleId matches the providerAccountId.
          const isAccountLinked = existingUser.googleId === account.providerAccountId;

          if (!isAccountLinked) {
            // User exists, but this Google account is not linked to it.
            // Link the Google account to the existing user by updating their googleId.
            await userRepository.update(
              existingUser.id,
              { googleId: account.providerAccountId }
            );
            // Note: The original linkAccount also stored accessToken, refreshToken etc.
            // This simplified version only stores googleId. A dedicated 'accounts' table
            // and corresponding repository methods would be needed for full functionality.
          }
          // Update the NextAuth user object with the actual database user ID and role
          user.id = existingUser.id;
          user.role = existingUser.authRole as 'admin' | 'user'; // Use augmented type
          return true; // Allow sign-in
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role // Use augmented type
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as 'admin' | 'user'
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
}
