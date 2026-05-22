const identity = (value) => String(value || '');

export const translateAuthApiMessage = ({ message, locale, t }) => {
	const raw = String(message || '').trim();
	if (!raw) return '';
	if (locale !== 'vi') return raw;

	const translators = {
		'Name is required': () => t('auth.errors.registerMissingFields'),
		'Email is required': () => t('auth.errors.emailRequired'),
		'Email is invalid': () => 'Email không hợp lệ.',
		'Password is required': () => 'Vui lòng nhập mật khẩu.',
		'Password must be at least 6 characters': () => 'Mật khẩu phải có ít nhất 6 ký tự.',
		'User already registered': () => 'Email này đã được đăng ký.',
		'User not registered': () => 'Tài khoản chưa được đăng ký.',
		'Email not verified': () => 'Email chưa được xác minh.',
		'User is inactive': () => 'Tài khoản đang bị tạm ngưng.',
		'Authentication error': () => 'Thông tin đăng nhập không chính xác.',
		'Registration successful. Please verify your email.': () => t('auth.success.registered'),
		'Registration successful. Email service is not configured.': () =>
			'Đăng ký thành công nhưng hệ thống email chưa được cấu hình.',
		'Registration successful. Failed to send verification email.': () =>
			'Đăng ký thành công nhưng chưa gửi được email xác minh.',
		'Verification email sent.': () => 'Đã gửi lại email xác minh.',
		'Failed to send verification email.': () => 'Không thể gửi email xác minh.',
		'Email service is not configured.': () => 'Hệ thống email chưa được cấu hình.',
		'If the email exists, we sent a verification link.': () =>
			'Nếu email tồn tại, chúng tôi đã gửi liên kết xác minh.',
		'Email already verified.': () => 'Email đã được xác minh.',
		'If the email exists, we sent a reset link.': () => t('auth.success.resetRequested'),
		'Reset instructions sent.': () => t('auth.success.resetRequested'),
		'Failed to send reset password email.': () => 'Không thể gửi email đặt lại mật khẩu.',
		'Reset token is invalid or expired': () => t('auth.errors.resetInvalid'),
		'Reset token is required': () => t('auth.errors.resetInvalid'),
		'Password reset success': () => t('auth.success.resetSuccess'),
		'Email verified': () => t('auth.success.verifySuccess')
	};

	return (translators[raw] || identity)(raw);
};

