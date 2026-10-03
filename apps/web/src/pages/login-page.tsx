import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { AuthCard } from '../components/auth-card';
import { Button } from '../components/button';
import { Form } from '../components/form';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { AuthServiceToken, type Credentials } from '../services/auth.service';

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Não foi possível entrar. Tente novamente.';
  if (error.status === 401) return 'E-mail ou senha inválidos';
  if (error.status === 403) {
    return /blocked/i.test(error.message)
      ? 'Sua conta está bloqueada. Fale com um administrador.'
      : 'Sua conta ainda aguarda aprovação de um administrador.';
  }
  if (error.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  return 'Não foi possível entrar. Tente novamente.';
}

export function LoginPage() {
  const auth = useService(AuthServiceToken);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: (input: Credentials) => auth.login(input),
    onSuccess: (user) => {
      queryClient.setQueryData(['me'], user);
      navigate('/');
    },
  });

  return (
    <AuthCard title="Entrar">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          login.mutate({
            email: String(data.get('email')),
            password: String(data.get('password')),
          });
        }}
      >
        <Form.Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Form.Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {login.isError && <Form.Error>{loginErrorMessage(login.error)}</Form.Error>}
        <Button variant="primary" type="submit" disabled={login.isPending}>
          Entrar
        </Button>
      </Form>
      <p className="auth-alt">
        Ainda não tem conta? <Link to="/register">Cadastre-se</Link>
      </p>
    </AuthCard>
  );
}
