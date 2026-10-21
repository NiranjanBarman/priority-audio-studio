#pragma once
// Lock-free SPSC ring buffer for real-time audio.
// Producer = JS/main thread (pushAudio)
// Consumer = WASAPI render thread (render loop)
// SPSC is safe because exactly one producer and one consumer touch each
// atomic — no ABA problem, no lock needed.

#include <atomic>
#include <cstdint>
#include <cstring>
#include <algorithm>

class RingBuffer {
public:
    RingBuffer(size_t capacityFloats)
        : capacity_(nextPowerOfTwo(capacityFloats)),
          mask_(capacity_ - 1),
          data_(new float[capacity_]),
          writePos_(0),
          readPos_(0) {
        std::memset(data_, 0, sizeof(float) * capacity_);
    }

    ~RingBuffer() { delete[] data_; }

    RingBuffer(const RingBuffer&) = delete;
    RingBuffer& operator=(const RingBuffer&) = delete;

    // Producer side. Returns number of floats actually written.
    size_t write(const float* src, size_t count) {
        const uint32_t w = writePos_.load(std::memory_order_relaxed);
        const uint32_t r = readPos_.load(std::memory_order_acquire);
        const size_t available = capacity_ - (w - r);
        const size_t n = std::min(count, available);
        for (size_t i = 0; i < n; ++i) {
            data_[(w + i) & mask_] = src[i];
        }
        writePos_.store(w + static_cast<uint32_t>(n), std::memory_order_release);
        return n;
    }

    // Consumer side. Returns number of floats actually read.
    size_t read(float* dst, size_t count) {
        const uint32_t r = readPos_.load(std::memory_order_relaxed);
        const uint32_t w = writePos_.load(std::memory_order_acquire);
        const size_t available = w - r;
        const size_t n = std::min(count, available);
        for (size_t i = 0; i < n; ++i) {
            dst[i] = data_[(r + i) & mask_];
        }
        readPos_.store(r + static_cast<uint32_t>(n), std::memory_order_release);
        return n;
    }

    // Peek without advancing read pointer. Used for underrun detection.
    size_t peek(float* dst, size_t count) const {
        const uint32_t r = readPos_.load(std::memory_order_relaxed);
        const uint32_t w = writePos_.load(std::memory_order_acquire);
        const size_t available = w - r;
        const size_t n = std::min(count, available);
        for (size_t i = 0; i < n; ++i) {
            dst[i] = data_[(r + i) & mask_];
        }
        return n;
    }

    size_t available() const {
        return writePos_.load(std::memory_order_acquire) -
               readPos_.load(std::memory_order_acquire);
    }

    size_t capacity() const { return capacity_; }

    void clear() {
        readPos_.store(writePos_.load(std::memory_order_acquire),
                       std::memory_order_release);
    }

private:
    static size_t nextPowerOfTwo(size_t v) {
        size_t p = 1;
        while (p < v) p <<= 1;
        return p;
    }

    size_t capacity_;
    size_t mask_;
    float* data_;
    std::atomic<uint32_t> writePos_;
    std::atomic<uint32_t> readPos_;
};