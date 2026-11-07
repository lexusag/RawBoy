// Test only (included with -include into the engine sources): std::thread with a 16 MB stack. LibRaw instances are
// large, and macOS gives secondary threads 512 KB (Android and the web builds give them more).
#pragma once
#include <pthread.h>
#include <thread>
#include <functional>
#include <memory>
#include <vector>
#include <mutex>
#include <atomic>
#include <algorithm>
#include <string>
#include <cstring>
#include <chrono>
#include <exception>
namespace std {
class rawboy_thread {
public:
    template <typename F, typename... A>
    explicit rawboy_thread(F&& f, A&&... a)
        : fn_(new function<void()>(bind(forward<F>(f), forward<A>(a)...))) {
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setstacksize(&attr, 16u << 20);
        pthread_create(&t_, &attr, [](void* p) -> void* {
            unique_ptr<function<void()>> fn(static_cast<function<void()>*>(p));
            (*fn)();
            return nullptr;
        }, fn_);
        pthread_attr_destroy(&attr);
        joinable_ = true;
    }
    rawboy_thread(rawboy_thread&& o) noexcept : t_(o.t_), fn_(o.fn_), joinable_(o.joinable_) { o.joinable_ = false; }
    void join() { if (joinable_) pthread_join(t_, nullptr); joinable_ = false; }
    static unsigned hardware_concurrency() { return thread::hardware_concurrency(); }
private:
    pthread_t t_{};
    function<void()>* fn_;
    bool joinable_ = false;
};
}  // namespace std
#define thread rawboy_thread
