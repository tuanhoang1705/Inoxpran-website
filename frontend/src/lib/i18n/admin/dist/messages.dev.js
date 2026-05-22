"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.messages = exports.normalizeLocale = exports.locales = exports.defaultLocale = void 0;
var defaultLocale = 'vi';
exports.defaultLocale = defaultLocale;
var locales = ['vi', 'en'];
exports.locales = locales;

var normalizeLocale = function normalizeLocale(value) {
  return locales.includes(value) ? value : defaultLocale;
};

exports.normalizeLocale = normalizeLocale;
var messages = {
  vi: {
    common: {
      loading: 'Đang tải...',
      customer: 'Khách hàng',
      search: 'Tìm kiếm',
      close: 'Đóng',
      view: 'Xem',
      save: 'Lưu',
      reset: 'Đặt lại',
      update: 'Cập nhật',
      cancel: 'Hủy',
      confirm: 'Xác nhận',
      paginationPrev: 'Trang trước',
      paginationNext: 'Trang sau',
      pageLabel: 'Trang {page}',
      today: 'Hôm nay',
      home: 'Trang chủ',
      blog: 'Blog',
      total: 'Tổng cộng',
      addToCart: 'Thêm vào giỏ',
      checkout: 'Thanh toán',
      viewDetails: 'Xem chi tiết',
      viewCart: 'Xem giỏ',
      sampleProduct: 'Sản phẩm {index}',
      discountNote: 'Giá ưu đãi.',
      highQuality: 'Chất lượng cao.',
      highQualityDeal: 'Chất lượng cao, giá tốt.',
      stainlessPremium: 'Sản phẩm inox cao cấp.',
      currency: 'đ',
      viewAll: 'Xem tất cả',
      readMore: 'Xem thêm',
      scroll: 'Cuộn',
      errors: {
        productRequestFailed: 'Yêu cầu sản phẩm thất bại.',
        productRequestFailedWithStatus: 'Yêu cầu sản phẩm thất bại ({status})'
      }
    },
    admin: {
      toast: {
        title: 'Thông báo',
        closeLabel: 'Đóng thông báo',
        success: 'Thành công',
        error: 'Lỗi',
        info: 'Thông tin',
        warning: 'Cảnh báo'
      },
      nav: {
        dashboard: 'Tổng quan',
        products: 'Sản phẩm',
        blogs: 'Bài viết',
        bestSelling: 'Sản phẩm bán chạy',
        discounts: 'Mã giảm giá',
        contacts: 'Liên hệ tư vấn',
        approvals: 'Phê duyệt',
        users: 'Người dùng',
        orders: 'Đơn hàng',
        profile: 'Hồ sơ'
      },
      layout: {
        title: 'Quản trị Inoxpran',
        logout: 'Đăng xuất',
        language: 'Ngôn ngữ',
        langVi: 'Tiếng Việt',
        langEn: 'Tiếng Anh'
      },
      dashboard: {
        title: 'Tổng quan',
        recentUsers: 'Người dùng mới',
        recentProducts: 'Sản phẩm mới',
        latestUsers: 'Người dùng gần đây',
        latestProducts: 'Sản phẩm gần đây',
        view: 'Xem',
        edit: 'Sửa',
        noUsers: 'Chưa có người dùng mới.',
        noProducts: 'Chưa có sản phẩm mới.',
        siteSettings: {
          title: 'Cấu hình hiển thị website',
          description: 'Bật/tắt các tính năng giao diện website từ một nơi duy nhất.',
          noFlags: 'Hiện chưa có feature flag nào.',
          flagStatusEnabled: 'Trạng thái hiện tại: Đang bật.',
          flagStatusDisabled: 'Trạng thái hiện tại: Đang tắt.',
          saveButton: 'Lưu cấu hình',
          flags: {
            showDiscountBadge: {
              label: 'Hiển thị discount badge',
              description: 'Hiển thị phần trăm giảm giá trên danh sách và chi tiết sản phẩm.'
            }
          },
          errors: {
            update: 'Không thể cập nhật cấu hình hiển thị.',
            noValidFlags: 'Không tìm thấy feature flag hợp lệ để cập nhật.'
          },
          success: {
            updated: 'Đã cập nhật cấu hình hiển thị thành công.'
          }
        }
      },
      auth: {
        loginTitle: 'Đăng nhập quản trị',
        loginDesc: 'Đăng nhập để quản lý sản phẩm, đơn hàng và người dùng.',
        email: 'Email',
        password: 'Mật khẩu',
        loginButton: 'Đăng nhập',
        noAccount: 'Chưa có tài khoản?',
        createAccount: 'Tạo tài khoản',
        registerTitle: 'Tạo tài khoản quản trị',
        registerDesc: 'Đăng ký tài khoản quản trị để được phê duyệt.',
        name: 'Họ và tên',
        phone: 'Số điện thoại',
        redirecting: 'Đang chuyển...',
        redirectingHint: 'Đang chuyển đến trang chờ duyệt.',
        haveAccount: 'Đã có tài khoản?',
        errors: {
          missingCredentials: 'Vui lòng nhập email và mật khẩu.',
          loginFailed: 'Đăng nhập thất bại.',
          loginFailedWithReason: 'Đăng nhập thất bại: {reason}',
          sessionInitFailed: 'Không thể khởi tạo phiên quản trị.',
          registerMissingFields: 'Vui lòng nhập họ tên, email và mật khẩu.',
          registerFailed: 'Đăng ký thất bại.',
          registerFailedWithReason: 'Đăng ký thất bại: {reason}'
        },
        success: {
          login: 'Đăng nhập quản trị thành công.',
          registered: 'Tài khoản đã được tạo. Vui lòng chờ phê duyệt để kích hoạt.',
          loggedOut: 'Đã đăng xuất khỏi hệ thống quản trị.'
        }
      },
      pending: {
        title: 'Đang chờ duyệt',
        success: 'Tài khoản của bạn đã được tạo thành công.',
        nextTitle: 'Bước tiếp theo',
        nextDesc: 'Quản trị viên sẽ xem xét tài khoản của bạn.',
        statusLabel: 'Trạng thái',
        statusValue: 'Chờ phê duyệt',
        emailLabel: 'Email',
        notify: 'Chúng tôi sẽ thông báo khi tài khoản được duyệt.',
        backToLogin: 'Quay lại đăng nhập',
        loginHint: 'Bạn có thể đăng nhập sau khi tài khoản được kích hoạt.'
      },
      approvals: {
        approvePrompt: 'Nhập ghi chú phê duyệt (tùy chọn)',
        rejectPrompt: 'Nhập lý do từ chối (tùy chọn)',
        pageTitle: 'Phê duyệt quản trị',
        title: 'Phê duyệt quản trị',
        lede: 'Duyệt hoặc từ chối các tài khoản quản trị mới.',
        emptyTitle: 'Không có tài khoản chờ duyệt',
        emptyDesc: 'Khi có yêu cầu, danh sách sẽ hiển thị tại đây.',
        name: 'Họ tên',
        email: 'Email',
        phone: 'Số điện thoại',
        created: 'Ngày tạo',
        roles: 'Vai trò khi duyệt',
        rolesHelp: 'Mặc định cấp quyền Quản trị. Chỉ thêm CHAT_MANAGER cho nhân sự phụ trách lịch sử chatbox.',
        actions: 'Hành động',
        approveTitle: 'Phê duyệt',
        approve: 'Duyệt',
        rejectTitle: 'Từ chối',
        reject: 'Từ chối',
        errors: {
          load: 'Không thể tải danh sách tài khoản chờ duyệt.',
          missingId: 'Vui lòng nhập ID admin.',
          approveFailed: 'Không thể phê duyệt admin.',
          rejectFailed: 'Không thể từ chối admin.'
        },
        success: {
          approved: 'Đã phê duyệt admin.',
          rejected: 'Đã từ chối admin.'
        }
      },
      contacts: {
        pageTitle: 'Liên hệ tư vấn',
        title: 'Khách hàng cần tư vấn',
        lede: 'Quản lý thông tin khách hàng gửi form liên hệ và cập nhật trạng thái xử lý.',
        summaryLabel: 'Tổng yêu cầu',
        summaryValue: '{count} liên hệ',
        filters: {
          search: 'Tìm kiếm',
          searchPlaceholder: 'Tên, SĐT, email, nội dung...',
          status: 'Trạng thái',
          statusAll: 'Tất cả',
          apply: 'Lọc',
          reset: 'Xóa lọc'
        },
        emptyTitle: 'Chưa có yêu cầu liên hệ',
        emptyDesc: 'Form liên hệ chưa có dữ liệu gửi về.',
        status: {
          "new": 'Mới',
          processing: 'Đang xử lý',
          contacted: 'Đã liên hệ',
          closed: 'Đã chốt/đóng'
        },
        fields: {
          createdAt: 'Ngày gửi',
          company: 'Công ty/Dự án',
          city: 'Tỉnh/Thành',
          assignedTo: 'Phụ trách',
          email: 'Email',
          address: 'Địa chỉ',
          interest: 'Hạng mục',
          budget: 'Ngân sách',
          timeline: 'Tiến độ',
          preferredContact: 'Liên hệ ưu tiên',
          message: 'Nội dung',
          sourcePage: 'Nguồn',
          status: 'Trạng thái',
          internalNote: 'Ghi chú nội bộ',
          internalNotePlaceholder: 'Ghi chú cho đội tư vấn...',
          assignToMe: 'Gán cho tôi'
        },
        actions: {
          update: 'Cập nhật'
        },
        pagination: {
          prev: 'Trang trước',
          next: 'Trang sau',
          page: 'Trang {page} / {total}'
        },
        errors: {
          missingId: 'Thiếu ID liên hệ.',
          updateFailed: 'Không thể cập nhật liên hệ.',
          updateFailedWithReason: 'Không thể cập nhật liên hệ: {reason}'
        },
        success: {
          updated: 'Đã cập nhật liên hệ.'
        }
      },
      discounts: {
        confirmDelete: 'Bạn chắc chắn muốn xóa mã giảm giá này?',
        title: 'Mã giảm giá',
        createTitle: 'Tạo mã giảm giá',
        code: 'Mã',
        name: 'Tên',
        description: 'Mô tả',
        type: 'Loại',
        typeFixed: 'Giảm tiền cố định',
        typePercent: 'Giảm theo phần trăm',
        typeFreeShip: 'Miễn phí vận chuyển',
        value: 'Giá trị',
        maxValue: 'Giá trị tối đa',
        minOrder: 'Giá trị đơn tối thiểu',
        startDate: 'Ngày bắt đầu',
        endDate: 'Ngày kết thúc',
        maxUses: 'Số lần sử dụng tối đa',
        maxUsesPerUser: 'Số lần sử dụng mỗi người',
        appliesTo: 'Áp dụng cho',
        appliesAll: 'Tất cả sản phẩm',
        appliesSpecific: 'Sản phẩm cụ thể',
        customerAppliesTo: 'Khách hàng áp dụng',
        customerAll: 'Tất cả khách hàng',
        customerSpecific: 'Khách hàng cụ thể',
        customerIds: 'Danh sách ID khách hàng',
        customerIdsPlaceholder: 'Mỗi ID trên một dòng hoặc phân tách bằng dấu phẩy',
        productIds: 'Danh sách ID sản phẩm',
        productIdsPlaceholder: 'Mỗi ID trên một dòng hoặc phân tách bằng dấu phẩy',
        active: 'Đang hoạt động',
        createButton: 'Tạo mã giảm giá',
        status: 'Trạng thái',
        "delete": 'Xóa',
        empty: 'Chưa có mã giảm giá.',
        errors: {
          load: 'Không thể tải danh sách mã giảm giá.',
          missingFields: 'Vui lòng nhập đầy đủ thông tin mã giảm giá.',
          missingProductIds: 'Vui lòng nhập danh sách sản phẩm áp dụng.',
          missingCustomerIds: 'Vui lòng nhập danh sách khách hàng áp dụng.',
          createFailed: 'Tạo mã giảm giá thất bại.',
          deleteMissingId: 'Không tìm thấy mã giảm giá để xóa.',
          deleteFailed: 'Xóa mã giảm giá thất bại.'
        },
        success: {
          created: 'Tạo mã giảm giá thành công.',
          deleted: 'Đã xóa mã giảm giá.'
        }
      },
      orders: {
        title: 'Quản lý đơn hàng',
        heading: 'Quản lý đơn hàng',
        lede: 'Theo dõi đơn mới, xử lý yêu cầu huỷ và cập nhật trạng thái giao hàng trong một màn hình.',
        autoStatusHint: 'Một số trạng thái cuối sẽ được đồng bộ tự động theo luồng vận chuyển và xử lý hoàn/huỷ.',
        updateStatus: 'Cập nhật',
        detailsToggle: 'Chi tiết',
        orderId: 'Mã đơn hàng',
        statusLabel: 'Trạng thái',
        noTracking: 'Chưa có mã',
        noAddress: 'Chưa có địa chỉ',
        noTransitions: 'Không còn bước chuyển',
        emptyTitle: 'Không có đơn hàng phù hợp',
        emptyDesc: 'Hãy thử đổi bộ lọc hoặc từ khóa để tìm đơn cần xử lý.',
        tabs: {
          label: 'Bộ lọc đơn hàng',
          all: 'Tất cả',
          waiting: 'Chờ xử lý',
          shipping: 'Đang giao',
          completed: 'Hoàn thành',
          cancelRequested: 'Yêu cầu huỷ',
          cancelled: 'Đã huỷ',
          returned: 'Hoàn / Trả'
        },
        metrics: {
          total: 'Tổng đơn',
          waiting: 'Đang chờ',
          shipping: 'Đang giao',
          completed: 'Hoàn thành',
          cancelRequested: 'Cần duyệt huỷ'
        },
        filters: {
          search: 'Tìm đơn',
          searchPlaceholder: 'Mã đơn, tên người nhận, SĐT, mã vận đơn...',
          fromDate: 'Từ ngày',
          toDate: 'Đến ngày',
          apply: 'Áp dụng',
          clear: 'Xoá lọc'
        },
        table: {
          orderId: 'Mã đơn',
          customer: 'Khách hàng',
          items: 'Sản phẩm',
          total: 'Tổng tiền',
          placedAt: 'Ngày đặt',
          tracking: 'Vận đơn',
          status: 'Trạng thái',
          details: 'Chi tiết'
        },
        details: {
          receiver: 'Người nhận',
          phone: 'Điện thoại',
          email: 'Email',
          address: 'Địa chỉ',
          paymentStatus: 'Thanh toán',
          shippingStatus: 'Vận chuyển',
          codStatus: 'COD',
          updatedAt: 'Cập nhật lần cuối',
          cancelReason: 'Lý do huỷ'
        },
        pagination: {
          label: 'Phân trang đơn hàng',
          prev: 'Trang trước',
          next: 'Trang sau',
          page: 'Trang {page}/{total}'
        },
        status: {
          pending: 'Chờ xử lý',
          confirmed: 'Chờ giao hàng',
          shipped: 'Vận chuyển',
          cancelRequested: 'Yêu cầu hủy',
          cancelled: 'Đã hủy',
          delivered: 'Hoàn thành',
          returned: 'Trả hàng/Hoàn tiền'
        },
        errors: {
          load: 'Không thể tải danh sách đơn hàng.',
          missingFields: 'Vui lòng nhập mã đơn hàng và trạng thái.',
          invalidStatus: 'Trạng thái cập nhật không hợp lệ.',
          updateFailed: 'Cập nhật trạng thái đơn hàng thất bại.'
        },
        success: {
          updated: 'Cập nhật trạng thái đơn hàng thành công.'
        }
      },
      users: {
        title: 'Người dùng',
        filter: 'Lọc',
        statusAll: 'Tất cả trạng thái',
        statusLabel: 'Trạng thái',
        name: 'Tên',
        email: 'Email',
        roles: 'Vai trò',
        view: 'Xem',
        empty: 'Không tìm thấy người dùng.',
        back: 'Quay lại danh sách',
        detailTitle: 'Chi tiết người dùng',
        updateStatus: 'Cập nhật trạng thái',
        save: 'Lưu',
        notFound: 'Không tìm thấy người dùng.',
        status: {
          active: 'Hoạt động',
          inactive: 'Tạm ngưng',
          blocked: 'Bị chặn'
        },
        errors: {
          load: 'Không thể tải danh sách người dùng.',
          notFound: 'Không tìm thấy người dùng.',
          updateFailed: 'Cập nhật trạng thái người dùng thất bại.'
        },
        success: {
          updated: 'Cập nhật trạng thái người dùng thành công.'
        }
      },
      profile: {
        title: 'Hồ sơ quản trị',
        heading: 'Hồ sơ',
        name: 'Họ và tên',
        phone: 'Số điện thoại',
        avatarUrl: 'URL ảnh đại diện',
        avatarFile: 'Tệp ảnh đại diện',
        update: 'Cập nhật hồ sơ',
        errors: {
          load: 'Tải hồ sơ thất bại.',
          updateFailed: 'Cập nhật hồ sơ thất bại.'
        },
        success: {
          updated: 'Cập nhật hồ sơ thành công.'
        }
      },
      products: {
        title: 'Sản phẩm',
        drafts: 'Bản nháp',
        newDraft: 'Tạo bản nháp',
        name: 'Tên sản phẩm',
        type: 'Loại',
        price: 'Giá',
        admin: 'Người tạo',
        created: 'Ngày tạo',
        updated: 'Ngày cập nhật',
        status: 'Trạng thái',
        active: 'Đang hoạt động',
        published: 'Xuất bản',
        draft: 'Bản nháp',
        unknown: 'Không rõ',
        edit: 'Sửa',
        empty: 'Chưa có sản phẩm.',
        errors: {
          load: 'Không thể tải danh sách sản phẩm.'
        }
      },
      bestSelling: {
        title: 'Sản phẩm bán chạy',
        lede: 'Sắp xếp thứ tự hiển thị sản phẩm bán chạy trên trang chủ.',
        hint: 'Kéo sản phẩm từ danh sách bên phải vào đây để sắp xếp.',
        listTitle: 'Danh sách bán chạy',
        addTitle: 'Thêm sản phẩm',
        searchPlaceholder: 'Tìm sản phẩm...',
        add: 'Thêm',
        remove: 'Xóa',
        moveUp: 'Đưa lên',
        moveDown: 'Đưa xuống',
        save: 'Lưu thứ tự',
        empty: 'Chưa có sản phẩm bán chạy.',
        noResults: 'Không tìm thấy sản phẩm phù hợp.',
        errors: {
          load: 'Không thể tải danh sách sản phẩm bán chạy.',
          save: 'Không thể lưu thứ tự sản phẩm bán chạy.'
        },
        success: {
          saved: 'Đã lưu thứ tự sản phẩm bán chạy.'
        }
      },
      productsDrafts: {
        title: 'Bản nháp sản phẩm',
        lede: 'Quản lý các bản nháp sản phẩm chưa xuất bản.',
        backToList: 'Quay lại danh sách',
        newDraft: 'Tạo bản nháp',
        name: 'Tên sản phẩm',
        type: 'Loại',
        created: 'Ngày tạo',
        creator: 'Người tạo',
        status: 'Trạng thái',
        draftStatus: 'Bản nháp',
        publish: 'Xuất bản',
        empty: 'Chưa có bản nháp.',
        errors: {
          load: 'Không thể tải danh sách bản nháp.',
          missingId: 'Vui lòng chọn sản phẩm cần xuất bản.',
          publishFailed: 'Xuất bản sản phẩm thất bại.'
        },
        success: {
          publish: 'Đã xuất bản sản phẩm thành công.'
        }
      },
      productsNew: {
        title: 'Tạo sản phẩm',
        back: 'Quay lại sản phẩm',
        heading: 'Tạo sản phẩm mới',
        name: 'Tên sản phẩm',
        type: 'Loại sản phẩm',
        typeInox: 'Đồ gia dụng Inox',
        typeCastIron: 'Đồ gia dụng gang',
        typeElectronics: 'Gia dụng điện',
        originalPrice: 'Giá gốc',
        salePrice: 'Giá khuyến mãi',
        quantity: 'Số lượng',
        weight: 'Khối lượng',
        discountLabel: 'Giảm giá',
        description: 'Mô tả',
        descriptionPlaceholder: 'Nhập mô tả sản phẩm...',
        thumb: 'Ảnh đại diện',
        gallery: 'Ảnh chi tiết',
        galleryHint: 'Kéo thả hoặc chọn ảnh chi tiết 300x300px và dung lượng tối đa 1MB.',
        galleryPrompt: 'Kéo thả hoặc bấm để chọn ảnh',
        galleryLimit: 'Tối đa {count} ảnh.',
        removeImage: 'Xóa ảnh',
        attributes: 'Thông số kỹ thuật',
        manufacturer: 'Hãng sản xuất',
        model: 'Model',
        color: 'Màu sắc',
        variantsTitle: 'Phân loại sản phẩm',
        colors: 'Màu',
        colorNamePlaceholder: 'Tên màu',
        priceOverride: 'Giá riêng',
        addColor: 'Thêm màu',
        colorsEmpty: 'Chưa có màu.',
        sizes: 'Kích thước',
        sizePlaceholder: 'Nhập kích thước',
        addSize: 'Thêm',
        sizeEmpty: 'Chưa có kích thước.',
        comboTitle: 'Giá theo màu + size',
        comboHint: 'Thiết lập giá riêng cho từng tổ hợp màu và size.',
        selectColor: 'Chọn màu',
        selectSize: 'Chọn size',
        addCombo: 'Thêm tổ hợp',
        comboEmpty: 'Chưa có tổ hợp.',
        create: 'Tạo bản nháp',
        imageTooLarge: 'Ảnh quá lớn (tối đa {size}).',
        imageDimensions: 'Kích thước ảnh phải là {width}x{height}px.',
        imageInvalid: 'Tệp ảnh không hợp lệ.',
        errors: {
          missingFields: 'Vui lòng nhập đầy đủ thông tin sản phẩm.',
          attributesRequired: 'Vui lòng nhập hãng sản xuất, model và màu sắc.',
          attributesIncomplete: 'Vui lòng nhập đầy đủ hãng sản xuất, model và màu sắc.',
          missingOriginalPrice: 'Vui lòng nhập giá gốc sản phẩm.',
          missingSalePrice: 'Vui lòng nhập giá khuyến mãi.',
          thumbRequired: 'Vui lòng chọn ảnh đại diện.',
          createFailed: 'Tạo bản nháp thất bại.'
        },
        success: {
          created: 'Tạo bản nháp thành công.'
        }
      },
      productEditor: {
        title: 'Chỉnh sửa sản phẩm',
        lede: 'Cập nhật thông tin, giá và nội dung.',
        back: 'Quay lại sản phẩm',
        slug: 'Slug',
        updated: 'Cập nhật lần cuối',
        sectionBasics: 'Thông tin cơ bản',
        sectionBasicsDesc: 'Tên, loại và thông tin chính.',
        productName: 'Tên sản phẩm',
        productNamePlaceholder: 'Nhập tên sản phẩm',
        productType: 'Loại sản phẩm',
        sectionPricing: 'Giá & tồn kho',
        sectionPricingDesc: 'Quản lý giá và tồn kho.',
        originalPrice: 'Giá gốc',
        salePrice: 'Giá khuyến mãi',
        quantity: 'Số lượng',
        weight: 'Khối lượng',
        weightHelp: 'Đơn vị gram.',
        discountLabel: 'Giảm giá',
        sectionImages: 'Hình ảnh',
        sectionImagesDesc: 'Tải ảnh đại diện đúng chuẩn.',
        noImage: 'Chưa có ảnh',
        uploadLabel: 'Tải ảnh đại diện',
        uploadHelp: 'Kích thước 300x300px, tối đa 1MB.',
        gallery: 'Ảnh chi tiết',
        galleryHint: 'Kéo thả hoặc chọn ảnh chi tiết 300x300px, tối đa 1MB/ảnh.',
        galleryPrompt: 'Kéo thả hoặc bấm để chọn ảnh',
        galleryLimit: 'Tối đa {count} ảnh.',
        removeImage: 'Xóa ảnh',
        cropped: 'Đã cắt',
        sectionDescription: 'Mô tả',
        sectionDescriptionDesc: 'Cập nhật mô tả đầy đủ.',
        descriptionPlaceholder: 'Nhập mô tả sản phẩm...',
        advancedSummary: 'Tùy chọn nâng cao',
        advancedNote: 'Chỉ điền khi cần thêm thông tin kỹ thuật.',
        manufacturer: 'Hãng sản xuất',
        model: 'Model',
        color: 'Màu sắc',
        variantsTitle: 'Phân loại',
        colors: 'Màu',
        colorNamePlaceholder: 'Tên màu',
        priceOverride: 'Giá riêng',
        addColor: 'Thêm màu',
        colorsEmpty: 'Chưa có màu.',
        sizes: 'Kích thước',
        sizePlaceholder: 'Nhập kích thước',
        addSize: 'Thêm',
        sizeEmpty: 'Chưa có kích thước.',
        comboTitle: 'Giá theo màu + size',
        comboHint: 'Thiết lập giá riêng cho từng tổ hợp màu và size.',
        selectColor: 'Chọn màu',
        selectSize: 'Chọn size',
        addCombo: 'Thêm tổ hợp',
        comboEmpty: 'Chưa có tổ hợp.',
        save: 'Lưu thay đổi',
        saveHint: 'Lưu để cập nhật sản phẩm.',
        preview: 'Xem trước',
        stockLabel: 'Tồn kho: {count}',
        admin: 'Quản trị',
        weightLabel: 'Khối lượng',
        quickActions: 'Thao tác nhanh',
        quickActionsDesc: 'Xuất bản hoặc ẩn sản phẩm.',
        published: 'Đã xuất bản',
        publish: 'Xuất bản',
        unpublished: 'Đã ẩn',
        unpublish: 'Ẩn sản phẩm',
        "delete": 'Xóa sản phẩm',
        tipsTitle: 'Gợi ý',
        tip1: 'Dùng ảnh đại diện sắc nét, đúng kích thước.',
        tip2: 'Cập nhật giá khuyến mãi khi cần.',
        tip3: 'Mô tả rõ ràng giúp tăng chuyển đổi.',
        notFound: 'Không tìm thấy sản phẩm.',
        confirmDelete: 'Bạn có chắc muốn xóa sản phẩm này không?',
        imageTooLarge: 'Ảnh quá lớn (tối đa {size}).',
        imageDimensions: 'Ảnh phải là {width}x{height}px.',
        imageInvalid: 'Tệp ảnh không hợp lệ.',
        errors: {
          load: 'Không tìm thấy sản phẩm.',
          missingType: 'Vui lòng chọn loại sản phẩm.',
          attributesRequired: 'Vui lòng nhập hãng sản xuất, model và màu sắc.',
          attributesIncomplete: 'Vui lòng nhập đầy đủ hãng sản xuất, model và màu sắc.',
          updateFailed: 'Cập nhật sản phẩm thất bại.',
          publishFailed: 'Xuất bản sản phẩm thất bại.',
          unpublishFailed: 'Ẩn sản phẩm thất bại.',
          deleteFailed: 'Xóa sản phẩm thất bại.'
        },
        success: {
          updated: 'Đã cập nhật sản phẩm.',
          published: 'Đã xuất bản sản phẩm.',
          unpublished: 'Đã ẩn sản phẩm.',
          deleted: 'Đã xóa sản phẩm.'
        }
      },
      blogs: {
        title: 'Bài viết',
        lede: 'Quản lý danh sách bài viết, trạng thái xuất bản và hiệu suất đọc.',
        newPost: 'Viết bài mới',
        manageComments: 'Quản lý bình luận',
        filters: {
          searchPlaceholder: 'Tìm theo tiêu đề hoặc tóm tắt...',
          statusAll: 'Tất cả trạng thái',
          statusPublished: 'Đã xuất bản',
          statusDraft: 'Bản nháp',
          categoryAll: 'Tất cả danh mục',
          apply: 'Lọc'
        },
        table: {
          title: 'Tiêu đề',
          category: 'Danh mục',
          status: 'Trạng thái',
          updated: 'Cập nhật',
          views: 'Lượt xem',
          readTime: 'Thời gian đọc',
          actions: 'Thao tác'
        },
        status: {
          published: 'Đã xuất bản',
          draft: 'Bản nháp'
        },
        empty: 'Chưa có bài viết.',
        edit: 'Sửa',
        errors: {
          load: 'Không thể tải danh sách bài viết.',
          missingId: 'Thiếu ID bài viết.',
          publishFailed: 'Xuất bản bài viết thất bại.',
          unpublishFailed: 'Ẩn bài viết thất bại.'
        },
        success: {
          published: 'Đã xuất bản bài viết.',
          unpublished: 'Đã chuyển bài viết về bản nháp.'
        }
      },
      blogsComments: {
        title: 'Quản lý bình luận',
        errors: {
          load: 'Không thể tải bình luận.',
          missingId: 'Thiếu mã bình luận.',
          updateFailed: 'Cập nhật bình luận thất bại.',
          deleteFailed: 'Xóa bình luận thất bại.'
        },
        success: {
          approved: 'Đã duyệt bình luận.',
          rejected: 'Đã ẩn bình luận.',
          deleted: 'Đã xóa bình luận.'
        }
      },
      blogEditor: {
        createTitle: 'Viết bài mới',
        editTitle: 'Chỉnh sửa bài viết',
        lede: 'Soạn thảo nội dung blog với đầy đủ công cụ cho trang blog và chi tiết bài viết.',
        back: 'Quay lại danh sách bài viết',
        basicInfo: 'Thông tin cơ bản',
        title: 'Tiêu đề bài viết',
        slug: 'Slug URL',
        regenerateSlug: 'Tạo lại slug',
        excerpt: 'Tóm tắt ngắn',
        category: 'Danh mục',
        authorName: 'Tên tác giả',
        authorAvatar: 'Ký tự avatar',
        coverImage: 'Ảnh đại diện',
        coverHint: 'Khuyến nghị ảnh ngang (ví dụ 1200x675), tối đa 5MB.',
        replaceImage: 'Thay ảnh',
        cropZoom: 'Thu phóng',
        cropApply: 'Áp dụng crop',
        cropHint: 'Kéo ảnh để chỉnh vùng hiển thị, sau đó nhấn lưu để áp dụng crop.',
        cropPreviewAlt: 'Xem trước vùng cắt',
        closeLabel: 'Đóng',
        content: 'Nội dung chi tiết',
        contentHint: 'Dùng thanh công cụ để định dạng, chèn ảnh và liên kết.',
        tags: 'Từ khóa',
        tagPlaceholder: 'Nhập tag và nhấn Enter',
        tagsHint: 'Tag sẽ hiển thị ở cuối bài và hỗ trợ lọc.',
        seo: 'SEO',
        seoTitle: 'SEO title',
        seoDescription: 'SEO description',
        meta: 'Thông số hiển thị',
        readTime: 'Thời gian đọc (phút)',
        commentsCount: 'Số bình luận',
        views: 'Lượt xem ban đầu',
        status: 'Trạng thái',
        statusDraft: 'Bản nháp',
        statusPublished: 'Xuất bản',
        sendNewsletterLabel: 'Gửi thông báo tới người đăng ký',
        sendNewsletterHint: 'Gửi email thông báo khi xuất bản bài viết.',
        relatedPosts: 'Bài viết liên quan',
        relatedHint: 'Chọn tối đa 3 bài để hiển thị ở cuối trang chi tiết.',
        relatedEmpty: 'Chưa có bài viết nào để liên kết.',
        preview: 'Xem nhanh',
        previewEmpty: 'Bài xem trước sẽ xuất hiện sau khi bạn nhập tiêu đề và tóm tắt.',
        wordCount: '{count} từ',
        autoReadTime: '~{minutes} phút đọc',
        create: 'Tạo bài viết',
        update: 'Lưu thay đổi',
        publish: 'Xuất bản',
        unpublish: 'Chuyển về nháp',
        "delete": 'Xóa bài viết',
        confirmDelete: 'Bạn chắc chắn muốn xóa bài viết này?',
        errors: {
          load: 'Không thể tải dữ liệu bài viết.',
          missingRequired: 'Vui lòng nhập tiêu đề, tóm tắt, nội dung và ảnh đại diện.',
          createFailed: 'Tạo bài viết thất bại.',
          updateFailed: 'Cập nhật bài viết thất bại.',
          publishFailed: 'Xuất bản bài viết thất bại.',
          unpublishFailed: 'Ẩn bài viết thất bại.',
          deleteFailed: 'Xóa bài viết thất bại.',
          imageTooLarge: 'Ảnh quá lớn (tối đa {size}).',
          imageInvalid: 'Tệp ảnh không hợp lệ.'
        },
        success: {
          created: 'Tạo bài viết thành công.',
          updated: 'Cập nhật bài viết thành công.',
          published: 'Đã xuất bản bài viết.',
          unpublished: 'Đã chuyển bài viết về bản nháp.',
          deleted: 'Đã xóa bài viết.'
        }
      },
      editor: {
        placeholder: 'Nhập nội dung...',
        imageUploadFailed: 'Tải ảnh lên thất bại.',
        uploadMissingUrl: 'Không tìm thấy URL sau khi tải ảnh.',
        onlyImagesAllowed: 'Chỉ cho phép tải lên các tệp hình ảnh.',
        imageAdded: 'Đã thêm hình ảnh.',
        linkUrlRequired: 'Vui lòng nhập đường dẫn liên kết.',
        linkAdded: 'Đã thêm liên kết.',
        bold: 'Chữ đậm',
        italic: 'Chữ nghiêng',
        underline: 'Gạch chân',
        strike: 'Gạch ngang',
        bulletList: 'Danh sách dấu chấm',
        numberedList: 'Danh sách số',
        alignLeft: 'Căn trái',
        alignCenter: 'Căn giữa',
        alignRight: 'Căn phải',
        textColor: 'Màu chữ',
        insertImage: 'Chèn ảnh',
        insertLink: 'Chèn liên kết',
        linkUrlPlaceholder: 'Nhập URL',
        linkTextPlaceholder: 'Nhập nội dung hiển thị của liên kết',
        add: 'Thêm',
        cancel: 'Hủy',
        clearFormatting: 'Xóa định dạng'
      }
    }
  },
  en: {
    common: {
      loading: 'Loading...',
      customer: 'Customer',
      search: 'Search',
      close: 'Close',
      view: 'View',
      save: 'Save',
      reset: 'Reset',
      update: 'Update',
      cancel: 'Cancel',
      confirm: 'Confirm',
      paginationPrev: 'Previous',
      paginationNext: 'Next',
      pageLabel: 'Page {page}',
      today: 'Today',
      home: 'Home',
      blog: 'Blog',
      total: 'Total',
      addToCart: 'Add to cart',
      checkout: 'Checkout',
      viewDetails: 'View details',
      viewCart: 'View cart',
      sampleProduct: 'Product {index}',
      discountNote: 'Special offer.',
      highQuality: 'High quality.',
      highQualityDeal: 'High quality, great price.',
      stainlessPremium: 'Premium stainless product.',
      currency: 'đ',
      viewAll: 'View all',
      readMore: 'Read more',
      scroll: 'Scroll',
      errors: {
        productRequestFailed: 'Product request failed.',
        productRequestFailedWithStatus: 'Product request failed ({status}).'
      }
    },
    admin: {
      toast: {
        title: 'Notification',
        closeLabel: 'Dismiss notification',
        success: 'Success',
        error: 'Error',
        info: 'Info',
        warning: 'Warning'
      },
      nav: {
        dashboard: 'Dashboard',
        products: 'Products',
        blogs: 'Blogs',
        bestSelling: 'Best-selling',
        discounts: 'Discounts',
        contacts: 'Consultations',
        approvals: 'Approvals',
        users: 'Users',
        orders: 'Orders',
        profile: 'Profile'
      },
      layout: {
        title: 'Inoxpran Admin',
        logout: 'Log out',
        language: 'Language',
        langVi: 'Vietnamese',
        langEn: 'English'
      },
      dashboard: {
        title: 'Dashboard',
        recentUsers: 'New users',
        recentProducts: 'New products',
        latestUsers: 'Latest users',
        latestProducts: 'Latest products',
        view: 'View',
        edit: 'Edit',
        noUsers: 'No recent users.',
        noProducts: 'No recent products.',
        siteSettings: {
          title: 'Website display settings',
          description: 'Enable or disable website UI features from one central place.',
          noFlags: 'No feature flags are available yet.',
          flagStatusEnabled: 'Current status: enabled.',
          flagStatusDisabled: 'Current status: disabled.',
          saveButton: 'Save settings',
          flags: {
            showDiscountBadge: {
              label: 'Show discount badge',
              description: 'Display discount percentage on product list and product detail pages.'
            }
          },
          errors: {
            update: 'Failed to update display settings.',
            noValidFlags: 'No valid feature flags were found to update.'
          },
          success: {
            updated: 'Display settings updated successfully.'
          }
        }
      },
      auth: {
        loginTitle: 'Admin sign in',
        loginDesc: 'Sign in to manage products, orders, and users.',
        email: 'Email',
        password: 'Password',
        loginButton: 'Sign in',
        noAccount: "Don't have an account?",
        createAccount: 'Create account',
        registerTitle: 'Create admin account',
        registerDesc: 'Register an admin account for approval.',
        name: 'Full name',
        phone: 'Phone number',
        redirecting: 'Redirecting...',
        redirectingHint: 'Taking you to the approval waiting page.',
        haveAccount: 'Already have an account?',
        errors: {
          missingCredentials: 'Please enter email and password.',
          loginFailed: 'Sign in failed.',
          loginFailedWithReason: 'Sign in failed: {reason}',
          sessionInitFailed: 'Unable to start admin session.',
          registerMissingFields: 'Please enter full name, email, and password.',
          registerFailed: 'Registration failed.',
          registerFailedWithReason: 'Registration failed: {reason}'
        },
        success: {
          login: 'Admin sign-in successful.',
          registered: 'Account created. Please wait for admin approval to activate.',
          loggedOut: 'You have signed out of the admin console.'
        }
      },
      pending: {
        title: 'Pending approval',
        success: 'Your account has been created successfully.',
        nextTitle: 'Next step',
        nextDesc: 'An administrator will review your request.',
        statusLabel: 'Status',
        statusValue: 'Pending approval',
        emailLabel: 'Email',
        notify: "We'll notify you once the account is approved.",
        backToLogin: 'Back to sign in',
        loginHint: 'You can sign in after your account is activated.'
      },
      approvals: {
        approvePrompt: 'Add an approval note (optional)',
        rejectPrompt: 'Add a rejection reason (optional)',
        pageTitle: 'Admin approvals',
        title: 'Admin approvals',
        lede: 'Approve or reject new admin accounts.',
        emptyTitle: 'No pending admins',
        emptyDesc: 'Requests will appear here when available.',
        name: 'Name',
        email: 'Email',
        phone: 'Phone',
        created: 'Created',
        roles: 'Roles on approval',
        rolesHelp: 'Admin is selected by default. Add CHAT_MANAGER only for staff who manage chat room history.',
        actions: 'Actions',
        approveTitle: 'Approve',
        approve: 'Approve',
        rejectTitle: 'Reject',
        reject: 'Reject',
        errors: {
          load: 'Failed to load pending admins.',
          missingId: 'Admin id is required.',
          approveFailed: 'Failed to approve admin.',
          rejectFailed: 'Failed to reject admin.'
        },
        success: {
          approved: 'Admin approved successfully.',
          rejected: 'Admin rejected successfully.'
        }
      },
      contacts: {
        pageTitle: 'Consultation requests',
        title: 'Consultation requests',
        lede: 'Review contact form submissions and update their status.',
        summaryLabel: 'Total requests',
        summaryValue: '{count} contacts',
        filters: {
          search: 'Search',
          searchPlaceholder: 'Name, phone, email, message...',
          status: 'Status',
          statusAll: 'All',
          apply: 'Apply',
          reset: 'Reset'
        },
        emptyTitle: 'No contact requests yet',
        emptyDesc: 'Contact form submissions will appear here.',
        status: {
          "new": 'New',
          processing: 'In progress',
          contacted: 'Contacted',
          closed: 'Closed'
        },
        fields: {
          createdAt: 'Submitted',
          company: 'Company/Project',
          city: 'City',
          assignedTo: 'Assigned to',
          email: 'Email',
          address: 'Address',
          interest: 'Project scope',
          budget: 'Budget',
          timeline: 'Timeline',
          preferredContact: 'Preferred contact',
          message: 'Message',
          sourcePage: 'Source',
          status: 'Status',
          internalNote: 'Internal note',
          internalNotePlaceholder: 'Leave a note for the team...',
          assignToMe: 'Assign to me'
        },
        actions: {
          update: 'Update'
        },
        pagination: {
          prev: 'Previous',
          next: 'Next',
          page: 'Page {page} / {total}'
        },
        errors: {
          missingId: 'Contact id is required.',
          updateFailed: 'Unable to update contact.',
          updateFailedWithReason: 'Unable to update contact: {reason}'
        },
        success: {
          updated: 'Contact updated.'
        }
      },
      discounts: {
        confirmDelete: 'Are you sure you want to delete this discount?',
        title: 'Discounts',
        createTitle: 'Create discount',
        code: 'Code',
        name: 'Name',
        description: 'Description',
        type: 'Type',
        typeFixed: 'Fixed amount',
        typePercent: 'Percentage',
        typeFreeShip: 'Free shipping',
        value: 'Value',
        maxValue: 'Max value',
        minOrder: 'Min order value',
        startDate: 'Start date',
        endDate: 'End date',
        maxUses: 'Max uses',
        maxUsesPerUser: 'Max uses per user',
        appliesTo: 'Applies to',
        appliesAll: 'All products',
        appliesSpecific: 'Specific products',
        customerAppliesTo: 'Customer eligibility',
        customerAll: 'All customers',
        customerSpecific: 'Specific customers',
        customerIds: 'Customer IDs',
        customerIdsPlaceholder: 'One ID per line or separated by commas',
        productIds: 'Product IDs',
        productIdsPlaceholder: 'One ID per line or separated by commas',
        active: 'Active',
        createButton: 'Create discount',
        status: 'Status',
        "delete": 'Delete',
        empty: 'No discounts yet.',
        errors: {
          load: 'Failed to load discounts.',
          missingFields: 'Please fill in all discount fields.',
          missingProductIds: 'Please provide product IDs for specific discounts.',
          missingCustomerIds: 'Please provide customer IDs for specific discounts.',
          createFailed: 'Failed to create discount.',
          deleteMissingId: 'Discount id is required.',
          deleteFailed: 'Failed to delete discount.'
        },
        success: {
          created: 'Discount created successfully.',
          deleted: 'Discount deleted.'
        }
      },
      orders: {
        title: 'Order management',
        heading: 'Order management',
        lede: 'Track new orders, review cancellation requests, and update fulfillment status from one workspace.',
        autoStatusHint: 'Some final states are synchronized automatically from shipping and return/cancellation workflows.',
        updateStatus: 'Update',
        detailsToggle: 'Details',
        orderId: 'Order ID',
        statusLabel: 'Status',
        noTracking: 'No tracking yet',
        noAddress: 'No address',
        noTransitions: 'No next transition',
        emptyTitle: 'No matching orders',
        emptyDesc: 'Try adjusting filters or search keywords.',
        tabs: {
          label: 'Order filters',
          all: 'All',
          waiting: 'Waiting',
          shipping: 'Shipping',
          completed: 'Completed',
          cancelRequested: 'Cancel requests',
          cancelled: 'Cancelled',
          returned: 'Return / Refund'
        },
        metrics: {
          total: 'Total orders',
          waiting: 'Waiting',
          shipping: 'Shipping',
          completed: 'Completed',
          cancelRequested: 'Needs cancel review'
        },
        filters: {
          search: 'Search orders',
          searchPlaceholder: 'Order ID, receiver, phone, tracking number...',
          fromDate: 'From date',
          toDate: 'To date',
          apply: 'Apply',
          clear: 'Clear'
        },
        table: {
          orderId: 'Order ID',
          customer: 'Customer',
          items: 'Items',
          total: 'Total',
          placedAt: 'Placed at',
          tracking: 'Tracking',
          status: 'Status',
          details: 'Details'
        },
        details: {
          receiver: 'Receiver',
          phone: 'Phone',
          email: 'Email',
          address: 'Address',
          paymentStatus: 'Payment',
          shippingStatus: 'Shipping',
          codStatus: 'COD',
          updatedAt: 'Last updated',
          cancelReason: 'Cancel reason'
        },
        pagination: {
          label: 'Order pagination',
          prev: 'Previous',
          next: 'Next',
          page: 'Page {page}/{total}'
        },
        status: {
          pending: 'Pending',
          confirmed: 'Waiting for delivery',
          shipped: 'Shipping',
          cancelRequested: 'Cancel requested',
          cancelled: 'Cancelled',
          delivered: 'Completed',
          returned: 'Return/Refund'
        },
        errors: {
          load: 'Failed to load orders.',
          missingFields: 'Please enter order id and status.',
          invalidStatus: 'Invalid status update.',
          updateFailed: 'Failed to update order status.'
        },
        success: {
          updated: 'Order status updated.'
        }
      },
      users: {
        title: 'Users',
        filter: 'Filter',
        statusAll: 'All statuses',
        statusLabel: 'Status',
        name: 'Name',
        email: 'Email',
        roles: 'Roles',
        view: 'View',
        empty: 'No users found.',
        back: 'Back to users',
        detailTitle: 'User detail',
        updateStatus: 'Update status',
        save: 'Save',
        notFound: 'User not found.',
        status: {
          active: 'Active',
          inactive: 'Inactive',
          blocked: 'Blocked'
        },
        errors: {
          load: 'Failed to load users.',
          notFound: 'User not found.',
          updateFailed: 'Failed to update user status.'
        },
        success: {
          updated: 'User status updated.'
        }
      },
      profile: {
        title: 'Admin profile',
        heading: 'Profile',
        name: 'Name',
        phone: 'Phone',
        avatarUrl: 'Avatar URL',
        avatarFile: 'Avatar file',
        update: 'Update profile',
        errors: {
          load: 'Failed to load profile.',
          updateFailed: 'Profile update failed.'
        },
        success: {
          updated: 'Profile updated successfully.'
        }
      },
      products: {
        title: 'Products',
        drafts: 'Drafts',
        newDraft: 'New draft',
        name: 'Name',
        type: 'Type',
        price: 'Price',
        admin: 'Admin',
        created: 'Created',
        updated: 'Updated',
        status: 'Status',
        active: 'Active',
        published: 'Published',
        draft: 'Draft',
        unknown: 'Unknown',
        edit: 'Edit',
        empty: 'No products found.',
        errors: {
          load: 'Failed to load products.'
        }
      },
      bestSelling: {
        title: 'Best-selling products',
        lede: 'Arrange the order of best-selling products on the homepage.',
        hint: 'Drag products from the right list into this panel to reorder.',
        listTitle: 'Best-selling list',
        addTitle: 'Add products',
        searchPlaceholder: 'Search products...',
        add: 'Add',
        remove: 'Remove',
        moveUp: 'Move up',
        moveDown: 'Move down',
        save: 'Save order',
        empty: 'No best-selling products yet.',
        noResults: 'No matching products found.',
        errors: {
          load: 'Failed to load best-selling products.',
          save: 'Failed to save best-selling order.'
        },
        success: {
          saved: 'Best-selling order saved.'
        }
      },
      productsDrafts: {
        title: 'Product drafts',
        lede: 'Manage drafts that are not published yet.',
        backToList: 'Back to list',
        newDraft: 'New draft',
        name: 'Name',
        type: 'Type',
        created: 'Created',
        creator: 'Created by',
        status: 'Status',
        draftStatus: 'Draft',
        publish: 'Publish',
        empty: 'No drafts available.',
        errors: {
          load: 'Failed to load drafts.',
          missingId: 'Please select a product to publish.',
          publishFailed: 'Failed to publish product.'
        },
        success: {
          publish: 'Product published.'
        }
      },
      productsNew: {
        title: 'New product',
        back: 'Back to products',
        heading: 'Create new product',
        name: 'Product name',
        type: 'Product type',
        typeInox: 'Stainless cookware',
        typeCastIron: 'Cast iron cookware',
        typeElectronics: 'Home appliances',
        originalPrice: 'Original price',
        salePrice: 'Sale price',
        quantity: 'Quantity',
        weight: 'Weight',
        discountLabel: 'Discount',
        description: 'Description',
        descriptionPlaceholder: 'Enter product description...',
        thumb: 'Thumbnail',
        gallery: 'Detail images',
        galleryHint: 'Drag & drop or select detail shots that are 300x300px and under 1MB each.',
        galleryPrompt: 'Drag & drop or click to select files',
        galleryLimit: 'You can select up to {count} images.',
        removeImage: 'Remove image',
        attributes: 'Attributes',
        manufacturer: 'Manufacturer',
        model: 'Model',
        color: 'Color',
        variantsTitle: 'Variants',
        colors: 'Colors',
        colorNamePlaceholder: 'Color name',
        priceOverride: 'Price override',
        addColor: 'Add color',
        colorsEmpty: 'No colors added yet.',
        sizes: 'Sizes',
        sizePlaceholder: 'Enter size',
        addSize: 'Add',
        sizeEmpty: 'No sizes added yet.',
        comboTitle: 'Color + size overrides',
        comboHint: 'Set custom prices for specific color and size combinations.',
        selectColor: 'Select color',
        selectSize: 'Select size',
        addCombo: 'Add combo',
        comboEmpty: 'No overrides yet.',
        create: 'Create draft',
        imageTooLarge: 'Image is too large (max {size}).',
        imageDimensions: 'Image must be {width}x{height}px.',
        imageInvalid: 'Invalid image file.',
        errors: {
          missingFields: 'Please fill in all required product fields.',
          duplicateName: 'This product name already exists.',
          attributesRequired: 'Please enter manufacturer, model, and color.',
          attributesIncomplete: 'Please complete manufacturer, model, and color.',
          missingOriginalPrice: 'Please enter the original price.',
          missingSalePrice: 'Please enter the sale price.',
          thumbRequired: 'Please select a thumbnail image.',
          createFailed: 'Failed to create draft.'
        },
        success: {
          created: 'Draft created successfully.'
        }
      },
      productEditor: {
        title: 'Edit product',
        lede: 'Update details, pricing, and content.',
        back: 'Back to products',
        slug: 'Slug',
        updated: 'Last updated',
        sectionBasics: 'Basics',
        sectionBasicsDesc: 'Name, type, and core info.',
        productName: 'Product name',
        productNamePlaceholder: 'Enter product name',
        productType: 'Product type',
        sectionPricing: 'Pricing & stock',
        sectionPricingDesc: 'Manage pricing and inventory.',
        originalPrice: 'Original price',
        salePrice: 'Sale price',
        quantity: 'Quantity',
        weight: 'Weight',
        weightHelp: 'Unit in grams.',
        discountLabel: 'Discount',
        sectionImages: 'Images',
        sectionImagesDesc: 'Upload a compliant thumbnail.',
        noImage: 'No image',
        uploadLabel: 'Upload thumbnail',
        uploadHelp: 'Size 300x300px, max 1MB.',
        gallery: 'Detail images',
        galleryHint: 'Drag & drop or select detail shots that are 300x300px and under 1MB each.',
        galleryPrompt: 'Drag & drop or click to select files',
        galleryLimit: 'You can select up to {count} images.',
        removeImage: 'Remove image',
        cropped: 'Cropped',
        sectionDescription: 'Description',
        sectionDescriptionDesc: 'Update the full description.',
        descriptionPlaceholder: 'Enter product description...',
        advancedSummary: 'Advanced options',
        advancedNote: 'Fill in only if you have extra technical details.',
        manufacturer: 'Manufacturer',
        model: 'Model',
        color: 'Color',
        variantsTitle: 'Variants',
        colors: 'Colors',
        colorNamePlaceholder: 'Color name',
        priceOverride: 'Price override',
        addColor: 'Add color',
        colorsEmpty: 'No colors added yet.',
        sizes: 'Sizes',
        sizePlaceholder: 'Enter size',
        addSize: 'Add',
        sizeEmpty: 'No sizes added yet.',
        comboTitle: 'Color + size overrides',
        comboHint: 'Set custom prices for specific color and size combinations.',
        selectColor: 'Select color',
        selectSize: 'Select size',
        addCombo: 'Add combo',
        comboEmpty: 'No overrides yet.',
        save: 'Save changes',
        saveHint: 'Save to update the product.',
        preview: 'Preview',
        stockLabel: 'In stock: {count}',
        admin: 'Admin',
        weightLabel: 'Weight',
        quickActions: 'Quick actions',
        quickActionsDesc: 'Publish or hide the product.',
        published: 'Published',
        publish: 'Publish',
        unpublished: 'Hidden',
        unpublish: 'Hide product',
        "delete": 'Delete product',
        tipsTitle: 'Tips',
        tip1: 'Use a sharp, properly sized thumbnail.',
        tip2: 'Update sale price when needed.',
        tip3: 'Clear descriptions improve conversion.',
        notFound: 'Product not found.',
        confirmDelete: 'Are you sure you want to delete this product?',
        imageTooLarge: 'Image is too large (max {size}).',
        imageDimensions: 'Image must be {width}x{height}px.',
        imageInvalid: 'Invalid image file.',
        errors: {
          load: 'Product not found.',
          missingType: 'Please select a product type.',
          attributesRequired: 'Please enter manufacturer, model, and color.',
          attributesIncomplete: 'Please complete manufacturer, model, and color.',
          updateFailed: 'Failed to update product.',
          publishFailed: 'Failed to publish product.',
          unpublishFailed: 'Failed to hide product.',
          deleteFailed: 'Failed to delete product.'
        },
        success: {
          updated: 'Product updated successfully.',
          published: 'Product published.',
          unpublished: 'Product hidden.',
          deleted: 'Product deleted.'
        }
      },
      blogs: {
        title: 'Blogs',
        lede: 'Manage blog articles, publishing status, and reading performance.',
        newPost: 'Write new post',
        manageComments: 'Manage comments',
        filters: {
          searchPlaceholder: 'Search by title or excerpt...',
          statusAll: 'All statuses',
          statusPublished: 'Published',
          statusDraft: 'Draft',
          categoryAll: 'All categories',
          apply: 'Apply'
        },
        table: {
          title: 'Title',
          category: 'Category',
          status: 'Status',
          updated: 'Updated',
          views: 'Views',
          readTime: 'Read time',
          actions: 'Actions'
        },
        status: {
          published: 'Published',
          draft: 'Draft'
        },
        empty: 'No blog posts found.',
        edit: 'Edit',
        errors: {
          load: 'Unable to load blog posts.',
          missingId: 'Missing blog post id.',
          publishFailed: 'Failed to publish blog post.',
          unpublishFailed: 'Failed to move blog post to draft.'
        },
        success: {
          published: 'Blog post published.',
          unpublished: 'Blog post moved to draft.'
        }
      },
      blogsComments: {
        title: 'Manage comments',
        errors: {
          load: 'Failed to load comments.',
          missingId: 'Missing comment id.',
          updateFailed: 'Failed to update comment.',
          deleteFailed: 'Failed to delete comment.'
        },
        success: {
          approved: 'Comment approved.',
          rejected: 'Comment hidden.',
          deleted: 'Comment deleted.'
        }
      },
      blogEditor: {
        createTitle: 'Write new post',
        editTitle: 'Edit blog post',
        lede: 'Create blog content with all tools needed for blog list and detail pages.',
        back: 'Back to blog list',
        basicInfo: 'Basic information',
        title: 'Post title',
        slug: 'URL slug',
        regenerateSlug: 'Regenerate slug',
        excerpt: 'Short excerpt',
        category: 'Category',
        authorName: 'Author name',
        authorAvatar: 'Avatar letter',
        coverImage: 'Cover image',
        coverHint: 'Recommended landscape image (e.g. 1200x675), max 5MB.',
        replaceImage: 'Replace image',
        cropZoom: 'Zoom',
        cropApply: 'Apply crop',
        cropHint: 'Drag the image to adjust the visible area, then save to apply the crop.',
        cropPreviewAlt: 'Crop preview',
        closeLabel: 'Close',
        content: 'Article content',
        contentHint: 'Use toolbar actions to format content, insert images, and links.',
        tags: 'Tags',
        tagPlaceholder: 'Type tag and press Enter',
        tagsHint: 'Tags are shown in post details and used for filtering.',
        seo: 'SEO',
        seoTitle: 'SEO title',
        seoDescription: 'SEO description',
        meta: 'Display settings',
        readTime: 'Read time (minutes)',
        commentsCount: 'Comments count',
        views: 'Initial views',
        status: 'Status',
        statusDraft: 'Draft',
        statusPublished: 'Published',
        sendNewsletterLabel: 'Send newsletter to subscribers',
        sendNewsletterHint: 'Send an email notification when publishing.',
        relatedPosts: 'Related posts',
        relatedHint: 'Select up to 3 posts to show in the detail page.',
        relatedEmpty: 'No posts available for linking.',
        preview: 'Quick preview',
        previewEmpty: 'Preview will appear after entering title and excerpt.',
        wordCount: '{count} words',
        autoReadTime: '~{minutes} min read',
        create: 'Create post',
        update: 'Save changes',
        publish: 'Publish',
        unpublish: 'Move to draft',
        "delete": 'Delete post',
        confirmDelete: 'Are you sure you want to delete this post?',
        errors: {
          load: 'Unable to load blog post data.',
          missingRequired: 'Please enter title, excerpt, content, and cover image.',
          createFailed: 'Failed to create blog post.',
          updateFailed: 'Failed to update blog post.',
          publishFailed: 'Failed to publish blog post.',
          unpublishFailed: 'Failed to move blog post to draft.',
          deleteFailed: 'Failed to delete blog post.',
          imageTooLarge: 'Image is too large (max {size}).',
          imageInvalid: 'Invalid image file.'
        },
        success: {
          created: 'Blog post created.',
          updated: 'Blog post updated.',
          published: 'Blog post published.',
          unpublished: 'Blog post moved to draft.',
          deleted: 'Blog post deleted.'
        }
      },
      editor: {
        placeholder: 'Write something...',
        imageUploadFailed: 'Image upload failed.',
        uploadMissingUrl: 'Upload URL is missing.',
        onlyImagesAllowed: 'Only image files are allowed.',
        imageAdded: 'Image added.',
        linkUrlRequired: 'Please enter a URL.',
        linkAdded: 'Link added.',
        bold: 'Bold',
        italic: 'Italic',
        underline: 'Underline',
        strike: 'Strikethrough',
        bulletList: 'Bulleted list',
        numberedList: 'Numbered list',
        alignLeft: 'Align left',
        alignCenter: 'Center',
        alignRight: 'Align right',
        textColor: 'Text color',
        insertImage: 'Insert image',
        insertLink: 'Insert link',
        linkUrlPlaceholder: 'Enter URL',
        linkTextPlaceholder: 'Link text',
        add: 'Add',
        cancel: 'Cancel',
        clearFormatting: 'Clear formatting'
      }
    }
  }
};
exports.messages = messages;
